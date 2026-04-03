const pool = require('../lib/db');

module.exports = async function handler(req, res) {
  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fighters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'New Fighter',
      image_data TEXT,
      crop JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  if (req.method === 'GET') {
    try {
      const result = await pool.query(
        'SELECT id, name, image_data, crop FROM fighters ORDER BY created_at ASC'
      );
      res.status(200).json(result.rows);
    } catch (err) {
      console.error('GET /api/fighters error:', err);
      res.status(500).json({ error: 'Failed to fetch fighters' });
    }
  } else if (req.method === 'POST') {
    try {
      const { id, name, imageData, crop } = req.body;
      await pool.query(
        `INSERT INTO fighters (id, name, image_data, crop)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           image_data = EXCLUDED.image_data,
           crop = EXCLUDED.crop,
           updated_at = NOW()`,
        [id, name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('POST /api/fighters error:', err);
      res.status(500).json({ error: 'Failed to save fighter' });
    }
  } else {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).end();
  }
};
