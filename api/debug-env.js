const { Pool } = require('pg');

module.exports = async function handler(req, res) {
  const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '6543'),
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    max: 1,
  };

  const info = {
    configUser: config.user,
    configHost: config.host,
    configPort: config.port,
    configDb: config.database,
    passwordSet: !!config.password,
    passwordLength: config.password ? config.password.length : 0,
  };

  try {
    const pool = new Pool(config);
    const result = await pool.query('SELECT current_user, version()');
    info.connected = true;
    info.currentUser = result.rows[0].current_user;
    await pool.end();
  } catch (err) {
    info.connected = false;
    info.error = err.message;
  }

  res.status(200).json(info);
};
