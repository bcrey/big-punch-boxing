// Email-code sign in. Codes and session tokens are stored hashed; review links are HMAC signed.
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ATTEMPTS = 5;
const CODES_PER_WINDOW = 5;            // per email, per CODE_WINDOW_MS
const CODE_WINDOW_MS = 15 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;    // one code per email per minute
const CODES_PER_IP_HOUR = 12;          // a party behind one router still fits
const CODES_PER_HOUR = 60;             // sitewide ceiling so a bot night costs at most 60 emails
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

// Returns { code } or { error: 'cooldown' | 'limit' }. Codes stay on record for an hour (expired ones
// no longer redeem) so the per-email, per-IP and sitewide limits count what was really sent.
async function issueCode(pool, email, ip = null) {
  await pool.query("DELETE FROM login_codes WHERE created_at < NOW() - interval '1 hour'");
  const usage = (await pool.query(`
    SELECT COUNT(*) FILTER (WHERE email = $1 AND created_at > NOW() - $2::interval)::int AS for_email,
           MAX(created_at) FILTER (WHERE email = $1) AS last_for_email,
           COUNT(*) FILTER (WHERE ip = $3)::int AS for_ip,
           COUNT(*)::int AS total
    FROM login_codes`, [email, `${CODE_WINDOW_MS} milliseconds`, ip])).rows[0];
  if (usage.last_for_email && Date.now() - new Date(usage.last_for_email).getTime() < CODE_COOLDOWN_MS) return { error: 'cooldown' };
  if (usage.for_email >= CODES_PER_WINDOW || usage.for_ip >= CODES_PER_IP_HOUR || usage.total >= CODES_PER_HOUR) return { error: 'limit' };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await pool.query('INSERT INTO login_codes (email, code_hash, ip, expires_at) VALUES ($1, $2, $3, $4)',
    [email, sha256(`${email}:${code}`), ip, new Date(Date.now() + CODE_TTL_MS)]);
  return { code };
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
