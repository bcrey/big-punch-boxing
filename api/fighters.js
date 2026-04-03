const { Pool } = require('pg');

function makePool() {
  return new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '6543'),
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
}

module.exports = async function handler(req, res) {
  const pool = makePool();
  try {
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
      const result = await pool.query(
        'SELECT id, name, image_data, crop FROM fighters ORDER BY created_at ASC'
      );
      res.status(200).json(result.rows);
    } else if (req.method === 'POST') {
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
    } else {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).end();
    }
  } catch (err) {
    console.error('fighters API error:', err);
    console.error('DB_USER was:', process.env.DB_USER);
    res.status(500).json({ error: err.message });
  } finally {
    await pool.end();
  }
};
