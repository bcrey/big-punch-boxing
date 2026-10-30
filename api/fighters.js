const { Pool } = require('pg');
const { ensureFighterTable } = require('../lib/fighter-schema');

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
  const p = getPool();
  try {
    if (req.method === 'GET') {
      await ensureFighterTable(p);
      const result = await p.query(
        'SELECT id, name, image_data, crop, body_style FROM fighters WHERE deleted_at IS NULL ORDER BY created_at ASC'
      );
      res.status(200).json(result.rows);
    } else if (req.method === 'POST') {
      await ensureFighterTable(p);
      const { id, name, imageData, crop, bodyStyle } = req.body;
      await p.query(
        `INSERT INTO fighters (id, name, image_data, crop, body_style)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'classic'))
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           image_data = EXCLUDED.image_data,
           crop = EXCLUDED.crop,
           body_style = COALESCE($5, fighters.body_style),
           updated_at = NOW()`,
        [id, name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null,
          ['shirt', 'classic'].includes(bodyStyle) ? bodyStyle : null]
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
