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
  const { id } = req.query;
  const pool = makePool();
  try {
    if (req.method === 'PUT') {
      const { name, imageData, crop } = req.body;
      await pool.query(
        `UPDATE fighters SET name = $1, image_data = $2, crop = $3, updated_at = NOW() WHERE id = $4`,
        [name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null, id]
      );
      res.status(200).json({ ok: true });
    } else if (req.method === 'DELETE') {
      await pool.query('DELETE FROM fighters WHERE id = $1', [id]);
      res.status(200).json({ ok: true });
    } else {
      res.setHeader('Allow', 'PUT, DELETE');
      res.status(405).end();
    }
  } catch (err) {
    console.error('fighter [id] API error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    await pool.end();
  }
};
