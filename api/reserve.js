const { db } = require('./_firebase');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { numbers, buyerName, buyerPhone, buyerEmail } = req.body;

  if (!numbers?.length || !buyerName || !buyerPhone) {
    return res.status(400).json({ error: 'Dados incompletos.' });
  }

  const PRICE_PER_NUMBER = 10;
  const total = numbers.length * PRICE_PER_NUMBER;

  try {
    const reservationRef = db.collection('reservations').doc();

    await db.runTransaction(async (t) => {
      const statusRef  = db.collection('numbers').doc('status');
      const statusDoc  = await t.get(statusRef);
      const current    = statusDoc.exists ? statusDoc.data() : {};

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

    const payment    = new Payment(mp);
    const mpResponse = await payment.create({
      body: {
        transaction_amount: total,
        description:        `Rifa JEESP 2026 — números: ${numbers.join(', ')}`,
        payment_method_id:  'pix',
        payer: {
          email:      buyerEmail || `${buyerPhone.replace(/\D/g, '')}@rifa.com`,
          first_name: buyerName.split(' ')[0],
          last_name:  buyerName.split(' ').slice(1).join(' ') || '-',
        },
        notification_url:   `${process.env.BASE_URL}/api/webhook`,
        external_reference: reservationRef.id,
      },
    });

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
