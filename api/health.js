const { getPool } = require('../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  try {
    const pool = getPool();
    const result = await pool.query('SELECT 1 AS ok');
    res.status(200).json({
      status: 'healthy',
      db: result.rows[0].ok === 1,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('health check error:', err);
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
};
