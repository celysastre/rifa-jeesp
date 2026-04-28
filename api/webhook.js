const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, data } = req.body;
  if (type !== 'payment') return res.status(200).end();

  const mpPaymentId = String(data?.id);
  if (!mpPaymentId) return res.status(400).end();

  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const mpPayment = await mpRes.json();

    const reservationId = mpPayment.external_reference;
    const mpStatus      = mpPayment.status;

    if (!reservationId) return res.status(200).end();

    const reservationRef = db.collection('reservations').doc(reservationId);
    const reservationDoc = await reservationRef.get();
    if (!reservationDoc.exists) return res.status(200).end();

    const { numbers } = reservationDoc.data();

    if (mpStatus === 'approved') {
      await db.runTransaction(async (t) => {
        const statusRef = db.collection('numbers').doc('status');
        const updates   = {};
        numbers.forEach((n) => { updates[String(n)] = 'sold'; });
        t.set(statusRef, updates, { merge: true });
        t.update(reservationRef, { status: 'confirmed', mpPaymentId });
      });

    } else if (['rejected', 'cancelled'].includes(mpStatus)) {
      await db.runTransaction(async (t) => {
        const statusRef = db.collection('numbers').doc('status');
        const updates   = {};
        numbers.forEach((n) => { updates[String(n)] = 'available'; });
        t.set(statusRef, updates, { merge: true });
        t.update(reservationRef, { status: 'rejected' });
      });
    }

    return res.status(200).end();

  } catch (err) {
    console.error('webhook error:', err);
    return res.status(500).end();
  }
};
