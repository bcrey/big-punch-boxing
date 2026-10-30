const { Pool } = require('pg');
const { ensureFighterTable } = require('../../lib/fighter-schema');

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
  const { id } = req.query;
  const p = getPool();
  try {
    if (req.method === 'PUT') {
      await ensureFighterTable(p);
      const { name, imageData, crop, bodyStyle } = req.body;
      await p.query(
        `UPDATE fighters SET name = $1, image_data = $2, crop = $3,
           body_style = COALESCE($5, body_style), updated_at = NOW() WHERE id = $4`,
        [name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null, id,
          ['shirt', 'classic'].includes(bodyStyle) ? bodyStyle : null]
      );
      res.status(200).json({ ok: true });
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
