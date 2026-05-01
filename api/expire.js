const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { reservationId } = req.body;
  if (!reservationId) return res.status(400).end();

  try {
    const reservationRef = db.collection('reservations').doc(reservationId);
    const reservationDoc = await reservationRef.get();

    if (!reservationDoc.exists) return res.status(200).end();

    const { status, numbers } = reservationDoc.data();
    if (status !== 'pending') return res.status(200).end();

    await db.runTransaction(async (t) => {
      const statusRef = db.collection('numbers').doc('status');
      const rollback  = {};
      numbers.forEach((n) => { rollback[String(n)] = 'available'; });
      t.set(statusRef, rollback, { merge: true });
      t.update(reservationRef, { status: 'expired' });
    });

    return res.status(200).end();
  } catch (err) {
    console.error('expire error:', err);
    return res.status(500).end();
  }
};
