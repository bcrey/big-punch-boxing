const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePool, response, useFakePool } = require('./fake-pool');

process.env.RESEND_API_KEY = 'test-key';
process.env.AUTH_SECRET = 'test-secret';
process.env.ADMIN_PIN = '4321';

const pool = fakePool();
useFakePool(pool);
const auth = require('../api/auth.js');
const publish = require('../api/publish.js');
const review = require('../api/review.js');
const admin = require('../api/admin.js');
const { sha256, reviewToken } = require('../lib/auth');

const sent = [];
global.fetch = async (url, options) => {
  sent.push(JSON.parse(options.body));
  return { ok: true, json: async () => ({ id: 'email-id' }), text: async () => '' };
};

const call = async (handler, method, body, extra = {}) => {
  const res = response();
  await handler({ method, body, headers: {}, query: {}, ...extra }, res);
  return res;
};
const asOwner = { headers: { authorization: 'Bearer ' + 'o'.repeat(43) } };

test.beforeEach(() => {
  pool.calls.length = 0;
  pool.rules.length = 0;
  sent.length = 0;
  pool.answer(/COUNT\(\*\)/, [{ count: 0 }]);
});

test('sign in emails a 6-digit code, limits guesses and returns a session token', async () => {
  const bad = await call(auth, 'POST', { action: 'request-code', email: 'not-an-email' });
  assert.equal(bad.statusCode, 400);

  const requested = await call(auth, 'POST', { action: 'request-code', email: ' Fan@Example.com ' });
  assert.equal(requested.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], 'fan@example.com');
  assert.match(sent[0].from, /fight@bcr\.co/);
  const code = /(\d{6}) is your/.exec(sent[0].subject)[1];
  const insert = pool.last(/INSERT INTO login_codes/);
  assert.equal(insert.values[1], sha256(`fan@example.com:${code}`), 'codes are stored hashed');
  assert.ok(!insert.values.includes(code));

  const stored = { id: 7, code_hash: insert.values[1], attempts: 0 };
  pool.answer(/FROM login_codes WHERE email/, () => [stored]);
  const wrong = await call(auth, 'POST', { action: 'verify', email: 'fan@example.com', code: '000000' });
  assert.equal(wrong.statusCode, 401);
  assert.match(pool.last(/attempts = attempts \+ 1/).sql, /UPDATE login_codes/);

  stored.attempts = 5;
  const lockedOut = await call(auth, 'POST', { action: 'verify', email: 'fan@example.com', code });
  assert.equal(lockedOut.statusCode, 401, 'the right code no longer works after five wrong guesses');

  stored.attempts = 2;
  const ok = await call(auth, 'POST', { action: 'verify', email: 'fan@example.com', code: code.slice(0, 3) + ' ' + code.slice(3) });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.data.email, 'fan@example.com');
  assert.match(ok.data.token, /^[A-Za-z0-9_-]{40,}$/);
  const sessionInsert = pool.last(/INSERT INTO sessions/);
  assert.equal(sessionInsert.values[0], sha256(ok.data.token), 'session tokens are stored hashed');
  assert.match(pool.last(/DELETE FROM login_codes WHERE email = \$1$/).sql, /DELETE/, 'a used code is removed');

  pool.answer(/FROM sessions/, values => values[0] === sha256(ok.data.token) ? [{ email: 'fan@example.com' }] : []);
  const me = await call(auth, 'GET', null, { headers: { authorization: 'Bearer ' + ok.data.token } });
  assert.deepEqual(me.data, { email: 'fan@example.com' });
  assert.equal((await call(auth, 'GET')).statusCode, 401);

  pool.answer(/COUNT\(\*\)/, [{ count: 5 }]);
  const tooMany = await call(auth, 'POST', { action: 'request-code', email: 'fan@example.com' });
  assert.equal(tooMany.statusCode, 429);
  assert.equal(sent.length, 1);
});

test('publishing alerts the admin with a review link, and the link approves or rejects once', async () => {
  pool.answer(/FROM sessions/, [{ email: 'fan@example.com' }]);
  const fighter = { id: 'f1', name: 'Big Lou', image_data: 'data:image/jpeg;base64,AAAA', crop: null, owner_email: 'fan@example.com', visibility: 'private' };
  pool.answer(/SELECT id, name, image_data, crop, body_style, owner_email, visibility/, () => [fighter]);

  assert.equal((await call(publish, 'POST', { id: 'f1', action: 'request' })).statusCode, 401);
  pool.answer(/FROM sessions/, [{ email: 'other@example.com' }]);
  assert.equal((await call(publish, 'POST', { id: 'f1', action: 'request' }, asOwner)).statusCode, 403);
  pool.answer(/FROM sessions/, [{ email: 'fan@example.com' }]);

  const requested = await call(publish, 'POST', { id: 'f1', action: 'request' }, asOwner);
  assert.equal(requested.statusCode, 200);
  assert.equal(requested.data.visibility, 'pending');
  assert.match(pool.last(/visibility = 'pending'/).sql, /UPDATE fighters/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], 'brian@teveyo.com');
  assert.equal(sent[0].reply_to, 'fan@example.com');
  assert.match(sent[0].subject, /Big Lou/);
  const link = /https:\/\/box\.bcr\.co\/api\/review\?token=([^"]+)/.exec(sent[0].html);
  assert.ok(link, 'the alert links to the review page');
  const token = decodeURIComponent(link[1]);

  fighter.visibility = 'pending';
  const page = await call(review, 'GET', null, { query: { token } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /fan@example\.com/);
  assert.match(page.body, /data-decision="approve"/);
  assert.match(page.body, /<img class="photo" src="data:image\/jpeg;base64,AAAA"/);

  const forged = await call(review, 'POST', { token: token.slice(0, -2) + 'xx', decision: 'approve' });
  assert.equal(forged.statusCode, 403);
  const approved = await call(review, 'POST', { token, decision: 'approve' });
  assert.equal(approved.statusCode, 200);
  assert.deepEqual(pool.last(/reviewed_at = NOW/).values, ['f1', 'public']);
  assert.equal(sent.at(-1).to[0], 'fan@example.com');
  assert.match(sent.at(-1).subject, /now in the public roster/);

  fighter.visibility = 'public';
  const again = await call(review, 'POST', { token, decision: 'reject' });
  assert.equal(again.statusCode, 409, 'a decided fighter cannot be flipped from an old email');

  const withdrawn = await call(publish, 'POST', { id: 'f1', action: 'withdraw' }, asOwner);
  assert.equal(withdrawn.data.visibility, 'private');

  fighter.image_data = null; fighter.visibility = 'private';
  assert.equal((await call(publish, 'POST', { id: 'f1', action: 'request' }, asOwner)).statusCode, 400, 'no photo, no publishing');
});

test('review tokens expire and the admin panel can approve, reject, hide and list fighters', async () => {
  const expired = Buffer.from('f1.' + (Date.now() - 1000)).toString('base64url');
  const { readReviewToken } = require('../lib/auth');
  assert.equal(readReviewToken(expired + '.' + 'a'.repeat(43)), null);
  assert.equal(readReviewToken(reviewToken('f1')), 'f1');

  const fighter = { id: 'f1', name: 'Big Lou', owner_email: 'fan@example.com', visibility: 'pending' };
  pool.answer(/SELECT id, name, image_data, crop, body_style, owner_email, visibility/, [fighter]);
  assert.equal((await call(admin, 'POST', { pin: 'wrong', action: 'list-pending' })).statusCode, 403);

  const pending = await call(admin, 'POST', { pin: '4321', action: 'list-pending' });
  assert.match(pool.last(/visibility = 'pending' ORDER BY submitted_at/).sql, /owner_email/);
  assert.equal(pending.statusCode, 200);

  const rejected = await call(admin, 'POST', { pin: '4321', action: 'reject', id: 'f1' });
  assert.equal(rejected.statusCode, 200);
  assert.deepEqual(pool.last(/reviewed_at = NOW/).values, ['f1', 'rejected']);
  assert.match(sent.at(-1).subject, /wasn't approved/);

  await call(admin, 'POST', { pin: '4321', action: 'unpublish', id: 'f1' });
  assert.match(pool.last(/visibility = 'private'/).sql, /UPDATE fighters/);
  await call(admin, 'POST', { pin: '4321', action: 'delete', id: 'f1' });
  assert.match(pool.last(/deleted_at = NOW/).sql, /UPDATE fighters/);
});
