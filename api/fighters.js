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

let tableReady = false;

async function ensureTable(p) {
  if (tableReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS fighters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'New Fighter',
      image_data TEXT,
      crop JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ DEFAULT NULL
    );
  `);
  await p.query(`
    ALTER TABLE fighters ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
  `);
  tableReady = true;
}

module.exports = async function handler(req, res) {
  const p = getPool();
  try {
    if (req.method === 'GET') {
      const result = await p.query(
        'SELECT id, name, image_data, crop FROM fighters WHERE deleted_at IS NULL ORDER BY created_at ASC'
      );
      res.status(200).json(result.rows);
    } else if (req.method === 'POST') {
      await ensureTable(p);
      const { id, name, imageData, crop } = req.body;
      await p.query(
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
    res.status(500).json({ error: err.message });
  }
};
