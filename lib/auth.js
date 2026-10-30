// Email-code sign in. Codes and session tokens are stored hashed; review links are HMAC signed.
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ATTEMPTS = 5;
const CODES_PER_WINDOW = 5;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const REVIEW_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;

// Review links are signed with AUTH_SECRET, or a key derived from the existing secrets when it is not set.
function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.DB_PASSWORD || process.env.ADMIN_PIN) return sha256(`${process.env.DB_PASSWORD || ''}|${process.env.ADMIN_PIN || ''}`);
  return null;
}

function bearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(header);
  return match ? match[1] : null;
}

async function getSession(req, pool) {
  const token = bearer(req);
  if (!token) return null;
  const result = await pool.query(
    'SELECT email FROM sessions WHERE token_hash = $1 AND expires_at > NOW()', [sha256(token)]);
  if (!result.rows[0]) return null;
  pool.query('UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1', [sha256(token)]).catch(() => {});
  return { email: result.rows[0].email, token };
}

async function issueCode(pool, email) {
  const recent = await pool.query(
    'SELECT COUNT(*)::int AS count FROM login_codes WHERE email = $1 AND created_at > NOW() - $2::interval',
    [email, `${CODE_WINDOW_MS} milliseconds`]);
  if (recent.rows[0].count >= CODES_PER_WINDOW) return null;
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await pool.query('DELETE FROM login_codes WHERE email = $1 OR expires_at < NOW()', [email]);
  await pool.query('INSERT INTO login_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
    [email, sha256(`${email}:${code}`), new Date(Date.now() + CODE_TTL_MS)]);
  return code;
}

// Returns a session token, or null when the code is wrong, expired or used up.
async function redeemCode(pool, email, code) {
  const pending = await pool.query(
    'SELECT id, code_hash, attempts FROM login_codes WHERE email = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [email]);
  const row = pending.rows[0];
  if (!row || row.attempts >= CODE_ATTEMPTS) return null;
  const expected = Buffer.from(row.code_hash);
  const given = Buffer.from(sha256(`${email}:${String(code).trim()}`));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    await pool.query('UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return null;
  }
  await pool.query('DELETE FROM login_codes WHERE email = $1', [email]);
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions (token_hash, email, expires_at) VALUES ($1, $2, $3)',
    [sha256(token), email, new Date(Date.now() + SESSION_TTL_MS)]);
  return token;
}

async function endSession(pool, token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function reviewToken(fighterId) {
  if (!secret()) return null;
  const payload = `${fighterId}.${Date.now() + REVIEW_TTL_MS}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

// Returns the fighter id for a valid, unexpired review token, otherwise null.
function readReviewToken(token) {
  if (!secret() || typeof token !== 'string') return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, 'base64url').toString();
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const at = payload.lastIndexOf('.');
  const expires = Number(payload.slice(at + 1));
  return expires > Date.now() ? payload.slice(0, at) : null;
}

module.exports = { normalizeEmail, validEmail, getSession, issueCode, redeemCode, endSession, reviewToken, readReviewToken, secret, sha256 };
