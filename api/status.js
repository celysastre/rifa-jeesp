const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { reservationId } = req.query;
  if (!reservationId) return res.status(400).json({ error: 'Missing reservationId' });

  try {
    const reservationRef = db.collection('reservations').doc(reservationId);
    const snap = await reservationRef.get();

    if (!snap.exists) return res.status(404).json({ status: 'not_found' });

    const { status, mpPaymentId, numbers } = snap.data();

    if (status !== 'pending') return res.status(200).json({ status });
    if (!mpPaymentId) return res.status(200).json({ status: 'pending' });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const mp = await mpRes.json();

    if (mp.status === 'approved') {
      await db.runTransaction(async (t) => {
        const statusRef = db.collection('numbers').doc('status');
        const updates = {};
        numbers.forEach((n) => { updates[String(n)] = 'sold'; });
        t.set(statusRef, updates, { merge: true });
        t.update(reservationRef, { status: 'confirmed' });
      });
      return res.status(200).json({ status: 'confirmed' });
    }

    if (['rejected', 'cancelled'].includes(mp.status)) {
      await db.runTransaction(async (t) => {
        const statusRef = db.collection('numbers').doc('status');
        const updates = {};
        numbers.forEach((n) => { updates[String(n)] = 'available'; });
        t.set(statusRef, updates, { merge: true });
        t.update(reservationRef, { status: 'rejected' });
      });
      return res.status(200).json({ status: 'rejected' });
    }

    return res.status(200).json({ status: 'pending' });
  } catch (err) {
    console.error('status error:', err);
    return res.status(500).end();
  }
};
