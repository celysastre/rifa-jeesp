const { db } = require('./_firebase');
const { MercadoPagoConfig, Payment } = require('mercadopago');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { numbers, buyerName, buyerPhone, buyerCpf, buyerEmail } = req.body;

  if (!numbers?.length || !buyerName || !buyerPhone || !buyerCpf) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  const cpfDigits = buyerCpf.replace(/\D/g, '');
  const payerEmail = buyerEmail || `${cpfDigits}@gmail.com`;

  const PRICE_PER_NUMBER = 20;
  const total      = numbers.length * PRICE_PER_NUMBER;
  const expiresAt  = new Date(Date.now() + 10 * 60 * 1000);
  const reservationRef = db.collection('reservations').doc();

  // Libera reservas vencidas antes de processar a nova
  try {
    const pendingSnap = await db.collection('reservations')
      .where('status', '==', 'pending')
      .get();
    const now = Date.now();
    const expired = pendingSnap.docs.filter((d) => {
      const exp = d.data().expiresAt;
      return exp && exp.toMillis() < now;
    });
    for (const expiredDoc of expired) {
      const { numbers: expiredNums } = expiredDoc.data();
      const rollback = {};
      expiredNums.forEach((n) => { rollback[String(n)] = 'available'; });
      await db.collection('numbers').doc('status').set(rollback, { merge: true });
      await expiredDoc.ref.update({ status: 'expired' });
    }
  } catch (cleanupErr) {
    console.error('cleanup error (non-fatal):', cleanupErr);
  }

  try {
    // 1. Reserva os números no Firestore
    await db.runTransaction(async (t) => {
      const statusRef = db.collection('numbers').doc('status');
      const statusDoc = await t.get(statusRef);
      const current   = statusDoc.exists ? statusDoc.data() : {};

      for (const n of numbers) {
        if (current[String(n)] && current[String(n)] !== 'available') {
          throw new Error(`Número ${n} já foi reservado.`);
        }
      }

      const updates = {};
      numbers.forEach((n) => { updates[String(n)] = 'reserved'; });
      t.set(statusRef, updates, { merge: true });

      t.set(reservationRef, {
        numbers,
        buyerName,
        buyerPhone,
        buyerCpf:   buyerCpf || '',
        buyerEmail: buyerEmail || '',
        total,
        status:      'pending',
        mpPaymentId: null,
        createdAt:   new Date(),
        expiresAt,
      });
    });

    // 2. Cria pagamento no Mercado Pago
    let mpResponse;
    try {
      const mp      = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const payment = new Payment(mp);

      const payerBody = {
        email:          payerEmail,
        first_name:     buyerName.split(' ')[0],
        last_name:      buyerName.split(' ').slice(1).join(' ') || 'Comprador',
        identification: { type: 'CPF', number: cpfDigits },
        entity_type:    'individual',
      };
      console.log('MP payer:', JSON.stringify({ ...payerBody, identification: { type: 'CPF', number: cpfDigits.slice(0,3) + '***' } }));

      mpResponse = await payment.create({
        body: {
          transaction_amount: total,
          description:        `Rifa JEESP 2026 — números: ${numbers.join(', ')}`,
          payment_method_id:  'pix',
          payer:              payerBody,
          notification_url:   `${process.env.BASE_URL}/api/webhook`,
          external_reference: reservationRef.id,
        },
      });
    } catch (mpErr) {
      const mpErrDetail = JSON.stringify(mpErr?.cause ?? mpErr?.message ?? mpErr);
      console.error('MP error full:', JSON.stringify(mpErr, null, 2));
      console.error('MP error:', mpErrDetail);
      const rollback = {};
      numbers.forEach((n) => { rollback[String(n)] = 'available'; });
      await db.collection('numbers').doc('status').set(rollback, { merge: true });
      await reservationRef.update({ status: 'mp_error' });
      return res.status(502).json({ error: `MP: ${mpErrDetail}` });
    }

    await reservationRef.update({ mpPaymentId: String(mpResponse.id) });

    return res.status(200).json({
      reservationId: reservationRef.id,
      pixQrCode:     mpResponse.point_of_interaction?.transaction_data?.qr_code,
      pixQrCodeB64:  mpResponse.point_of_interaction?.transaction_data?.qr_code_base64,
      pixCopyPaste:  mpResponse.point_of_interaction?.transaction_data?.qr_code,
      total,
    });

  } catch (err) {
    console.error('reserve error:', err);
    const userMessage = err.message?.includes('já foi reservado')
      ? err.message
      : 'Erro ao processar reserva. Tente novamente.';
    return res.status(409).json({ error: userMessage });
  }
};
