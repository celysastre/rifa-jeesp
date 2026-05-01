const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

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
      const { numbers } = expiredDoc.data();
      const rollback = {};
      numbers.forEach((n) => { rollback[String(n)] = 'available'; });
      await db.collection('numbers').doc('status').set(rollback, { merge: true });
      await expiredDoc.ref.update({ status: 'expired' });
    }

    return res.status(200).json({ expired: expired.length });
  } catch (err) {
    console.error('cleanup error:', err);
    return res.status(500).end();
  }
};
