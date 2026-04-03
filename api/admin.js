const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '6543'),
      database: process.env.DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

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
    if (action === 'list-deleted') {
      const result = await p.query(
        'SELECT id, name, image_data, crop, deleted_at FROM fighters WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
      );
      res.status(200).json(result.rows);

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
