// Owners ask for their fighter to join the public roster, or take it back out.
const { getPool } = require('../lib/db');
const { ensureFighterTable } = require('../lib/fighter-schema');
const { getSession } = require('../lib/auth');
const { loadFighter, submitForReview } = require('../lib/review');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const p = getPool();
  try {
    await ensureFighterTable(p);
    const session = await getSession(req, p);
    if (!session) return res.status(401).json({ error: 'Sign in first.' });
    const { id, action } = req.body || {};
    const fighter = id ? await loadFighter(p, id) : null;
    if (!fighter || fighter.owner_email !== session.email) return res.status(403).json({ error: 'You can only publish your own fighters.' });

    if (action === 'request') {
      if (!fighter.image_data) return res.status(400).json({ error: 'Add a photo before publishing.' });
      if (fighter.visibility === 'public') return res.status(200).json({ ok: true, visibility: 'public' });
      await submitForReview(p, fighter);
      return res.status(200).json({ ok: true, visibility: 'pending' });
    }
    if (action === 'withdraw') {
      await p.query("UPDATE fighters SET visibility = 'private', updated_at = NOW() WHERE id = $1", [fighter.id]);
      return res.status(200).json({ ok: true, visibility: 'private' });
    }
    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('publish API error:', err);
    res.status(500).json({ error: err.message });
  }
};
