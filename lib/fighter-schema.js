// Shared by roster reads and writes so older databases gain outfit support safely.
const ready = new WeakMap();

function ensureFighterTable(pool) {
  if (!ready.has(pool)) {
    ready.set(pool, (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fighters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT 'New Fighter',
          image_data TEXT,
          crop JSONB,
          body_style TEXT NOT NULL DEFAULT 'classic',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          deleted_at TIMESTAMPTZ DEFAULT NULL
        );
      `);
      await pool.query(`
        ALTER TABLE fighters
          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS body_style TEXT NOT NULL DEFAULT 'classic';
      `);
    })().catch(error => { ready.delete(pool); throw error; }));
  }
  return ready.get(pool);
}

module.exports = { ensureFighterTable };
