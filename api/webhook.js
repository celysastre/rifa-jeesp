import { db } from './_firebase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, data } = req.body;

  // MP envia varios tipos de notificação; só interessa payment
  if (type !== 'payment') return res.status(200).end();

  const mpPaymentId = String(data?.id);
  if (!mpPaymentId) return res.status(400).end();

  try {
    // Busca detalhes do pagamento direto na API do MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const mpPayment = await mpRes.json();

    const reservationId = mpPayment.external_reference;
    const mpStatus = mpPayment.status; // approved | pending | rejected | cancelled

    if (!reservationId) return res.status(200).end();

    const reservationRef = db.collection('reservations').doc(reservationId);
    const reservationDoc = await reservationRef.get();
    if (!reservationDoc.exists) return res.status(200).end();

    const { numbers } = reservationDoc.data();

    if (mpStatus === 'approved') {
      // Pagamento confirmado → marca números como vendidos
      await db.runTransaction(async (t) => {
        const statusRef = db.collection('numbers').doc('status');
        const updates = {};
        numbers.forEach((n) => { updates[String(n)] = 'sold'; });
        t.set(statusRef, updates, { merge: true });
        t.update(reservationRef, { status: 'confirmed', mpPaymentId });
      });

    } else if (['rejected', 'cancelled'].includes(mpStatus)) {
      // Pagamento falhou → libera os números de volta
      await db.runTransaction(async (t) => {
        const statusRef = db.collection('numbers').doc('status');
        const updates = {};
        numbers.forEach((n) => { updates[String(n)] = 'available'; });
        t.set(statusRef, updates, { merge: true });
        t.update(reservationRef, { status: 'rejected' });
      });
    }

    return res.status(200).end();

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).end();
  }
}
