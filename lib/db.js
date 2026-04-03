const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres.zqudjwavrsohyrmhqsyp',
  password: process.env.DB_PASSWORD || '',
  host: process.env.DB_HOST || 'aws-1-us-east-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543'),
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 5,
});

module.exports = pool;
