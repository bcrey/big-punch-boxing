module.exports = async function handler(req, res) {
  res.status(200).json({
    DB_USER: process.env.DB_USER ? process.env.DB_USER.slice(0, 10) + '...' : 'NOT SET',
    DB_PASSWORD: process.env.DB_PASSWORD ? '***set***' : 'NOT SET',
    DB_HOST: process.env.DB_HOST ? process.env.DB_HOST.slice(0, 15) + '...' : 'NOT SET',
    DB_PORT: process.env.DB_PORT || 'NOT SET',
    DB_NAME: process.env.DB_NAME || 'NOT SET',
    DATABASE_URL: process.env.DATABASE_URL ? 'SET (legacy)' : 'NOT SET',
    PGUSER: process.env.PGUSER || 'NOT SET',
    PGPASSWORD: process.env.PGPASSWORD ? '***set***' : 'NOT SET',
  });
};
