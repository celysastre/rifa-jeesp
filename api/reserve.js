const { db } = require('./_firebase');
const { MercadoPagoConfig, Payment } = require('mercadopago');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { numbers, buyerName, buyerPhone, buyerEmail } = req.body;

  if (!numbers?.length || !buyerName || !buyerPhone) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  const PRICE_PER_NUMBER = 10;
  const total = numbers.length * PRICE_PER_NUMBER;
  const reservationRef = db.collection('reservations').doc();

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
        buyerEmail: buyerEmail || '',
        total,
        status:      'pending',
        mpPaymentId: null,
        createdAt:   new Date(),
      });
    });

    // 2. Cria pagamento no Mercado Pago
    let mpResponse;
    try {
      const mp      = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const payment = new Payment(mp);

      mpResponse = await payment.create({
        body: {
          transaction_amount: total,
          description:        `Rifa JEESP 2026 — números: ${numbers.join(', ')}`,
          payment_method_id:  'pix',
          payer: {
            email:      buyerEmail || `pagador@rifajeesp.com`,
            first_name: buyerName.split(' ')[0],
            last_name:  buyerName.split(' ').slice(1).join(' ') || 'Comprador',
          },
          notification_url:   `${process.env.BASE_URL}/api/webhook`,
          external_reference: reservationRef.id,
        },
      });
    } catch (mpErr) {
      // Se o MP falhar, libera os números de volta
      const mpErrDetail = JSON.stringify(mpErr?.cause ?? mpErr?.message ?? mpErr);
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
