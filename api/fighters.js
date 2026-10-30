const { getPool } = require('../lib/db');
const { ensureFighterTable } = require('../lib/fighter-schema');
const { getSession } = require('../lib/auth');
const { submitForReview } = require('../lib/review');

const bodyStyleOf = value => ['shirt', 'classic'].includes(value) ? value : null;

module.exports = async function handler(req, res) {
  const p = getPool();
  try {
    await ensureFighterTable(p);
    const session = await getSession(req, p);
    const me = session?.email || null;

    if (req.method === 'GET') {
      // Everyone sees public fighters; signed-in players also get their own private and pending ones.
      const result = await p.query(
        `SELECT id, name, image_data, crop, body_style, visibility, COALESCE(owner_email = $1, false) AS mine
         FROM fighters WHERE deleted_at IS NULL AND (visibility = 'public' OR owner_email = $1)
         ORDER BY created_at ASC`, [me]);
      res.status(200).json(result.rows);
    } else if (req.method === 'POST') {
      if (!me) return res.status(401).json({ error: 'Sign in to add fighters.' });
      const { id, name, imageData, crop, bodyStyle } = req.body;
      if (typeof id !== 'string' || !id || id.length > 64) return res.status(400).json({ error: 'Missing fighter id' });
      const existing = await p.query('SELECT owner_email, visibility FROM fighters WHERE id = $1', [id]);
      const current = existing.rows[0];
      if (current && current.owner_email !== me) return res.status(403).json({ error: 'That fighter belongs to someone else.' });
      await p.query(
        `INSERT INTO fighters (id, name, image_data, crop, body_style, owner_email, visibility)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'classic'), $6, 'private')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           image_data = EXCLUDED.image_data,
           crop = EXCLUDED.crop,
           body_style = COALESCE($5, fighters.body_style),
           updated_at = NOW()`,
        [id, name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null, bodyStyleOf(bodyStyle), me]
      );
      // A public fighter that changes goes back through approval so the shared roster stays reviewed.
      let visibility = current?.visibility || 'private';
      if (visibility === 'public') {
        await submitForReview(p, { id, name: name || 'New Fighter', owner_email: me });
        visibility = 'pending';
      }
      res.status(200).json({ ok: true, visibility });
    } else {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).end();
    }
  } catch (err) {
    console.error('fighters API error:', err);
    res.status(500).json({ error: err.message });
  }
};
