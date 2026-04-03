require('dotenv').config();
const pool = require('../lib/db');

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS fighters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'New Fighter',
        image_data TEXT,
        crop JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Table "fighters" created (or already exists).');
  } catch (err) {
    console.error('Error creating table:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

init();
