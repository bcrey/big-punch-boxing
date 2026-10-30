const { getPool } = require('../../lib/db');
const { ensureFighterTable } = require('../../lib/fighter-schema');
const { getSession } = require('../../lib/auth');
const { submitForReview } = require('../../lib/review');

const bodyStyleOf = value => ['shirt', 'classic'].includes(value) ? value : null;

module.exports = async function handler(req, res) {
  const { id } = req.query;
  const p = getPool();
  try {
    await ensureFighterTable(p);
    const session = await getSession(req, p);
    if (!session) return res.status(401).json({ error: 'Sign in to change fighters.' });
    const owned = await p.query('SELECT visibility FROM fighters WHERE id = $1 AND owner_email = $2 AND deleted_at IS NULL', [id, session.email]);
    if (!owned.rows[0]) return res.status(403).json({ error: 'You can only change your own fighters.' });

    if (req.method === 'PUT') {
      const { name, imageData, crop, bodyStyle } = req.body;
      await p.query(
        `UPDATE fighters SET name = $1, image_data = $2, crop = $3,
           body_style = COALESCE($5, body_style), updated_at = NOW() WHERE id = $4`,
        [name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null, id, bodyStyleOf(bodyStyle)]
      );
      let visibility = owned.rows[0].visibility;
      if (visibility === 'public') {
        await submitForReview(p, { id, name: name || 'New Fighter', owner_email: session.email });
        visibility = 'pending';
      }
      res.status(200).json({ ok: true, visibility });
    } else if (req.method === 'DELETE') {
      await p.query('UPDATE fighters SET deleted_at = NOW() WHERE id = $1', [id]);
      res.status(200).json({ ok: true });
    } else {
      res.setHeader('Allow', 'PUT, DELETE');
      res.status(405).end();
    }
  } catch (err) {
    console.error('fighter [id] API error:', err);
    res.status(500).json({ error: err.message });
  }
};
