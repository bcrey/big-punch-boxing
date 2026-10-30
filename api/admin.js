const { getPool } = require('../lib/db');
const { ensureFighterTable } = require('../lib/fighter-schema');
const { loadFighter, decide } = require('../lib/review');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const { pin, action, id } = req.body;
  const adminPin = process.env.ADMIN_PIN;

  if (!adminPin || pin !== adminPin) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }

  const p = getPool();
  try {
    await ensureFighterTable(p);
    if (action === 'list-deleted') {
      const result = await p.query(
        'SELECT id, name, image_data, crop, deleted_at FROM fighters WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
      );
      res.status(200).json(result.rows);

    } else if (action === 'list-pending') {
      const result = await p.query(
        "SELECT id, name, image_data, crop, owner_email, submitted_at FROM fighters WHERE deleted_at IS NULL AND visibility = 'pending' ORDER BY submitted_at ASC"
      );
      res.status(200).json(result.rows);

    } else if (action === 'list-public') {
      const result = await p.query(
        "SELECT id, name, image_data, crop, owner_email, reviewed_at FROM fighters WHERE deleted_at IS NULL AND visibility = 'public' ORDER BY created_at ASC"
      );
      res.status(200).json(result.rows);

    } else if (action === 'approve' || action === 'reject') {
      if (!id) return res.status(400).json({ error: 'Missing fighter id' });
      const fighter = await loadFighter(p, id);
      if (!fighter) return res.status(404).json({ error: 'Fighter not found' });
      await decide(p, fighter, action === 'approve');
      res.status(200).json({ ok: true });

    } else if (action === 'unpublish') {
      if (!id) return res.status(400).json({ error: 'Missing fighter id' });
      await p.query("UPDATE fighters SET visibility = 'private', updated_at = NOW() WHERE id = $1", [id]);
      res.status(200).json({ ok: true });

    } else if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'Missing fighter id' });
      await p.query('UPDATE fighters SET deleted_at = NOW() WHERE id = $1', [id]);
      res.status(200).json({ ok: true });

    } else if (action === 'restore') {
      if (!id) return res.status(400).json({ error: 'Missing fighter id' });
      await p.query(
        'UPDATE fighters SET deleted_at = NULL, updated_at = NOW() WHERE id = $1',
        [id]
      );
      res.status(200).json({ ok: true });

    } else if (action === 'permanent-delete') {
      if (!id) return res.status(400).json({ error: 'Missing fighter id' });
      await p.query('DELETE FROM fighters WHERE id = $1', [id]);
      res.status(200).json({ ok: true });

    } else {
      res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('admin API error:', err);
    res.status(500).json({ error: err.message });
  }
};
