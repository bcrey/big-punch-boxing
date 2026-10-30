// Shared by roster reads and writes so older databases gain outfit and account support safely.
const ready = new WeakMap();

// Fighters are 'public' (everyone sees them), 'private' (owner only), 'pending' (owner only, awaiting
// admin approval) or 'rejected' (owner only, approval declined). Rows from before accounts stay public.
const VISIBILITIES = ['public', 'private', 'pending', 'rejected'];

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
          ADD COLUMN IF NOT EXISTS body_style TEXT NOT NULL DEFAULT 'classic',
          ADD COLUMN IF NOT EXISTS owner_email TEXT,
          ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
          ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS login_codes (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          attempts INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );
      `);
    })().catch(error => { ready.delete(pool); throw error; }));
  }
  return ready.get(pool);
}

module.exports = { ensureFighterTable, VISIBILITIES };
