const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureFighterTable } = require('../lib/fighter-schema');
const { fakePool, response, useFakePool } = require('./fake-pool');

const pool = fakePool();
useFakePool(pool);
const fighters = require('../api/fighters.js');
const fighterById = require('../api/fighters/[id].js');

const session = email => ({ headers: email ? { authorization: 'Bearer ' + 'x'.repeat(40) } : {} });
const call = async (handler, method, body, who, query = { id: 'one' }) => {
  const res = response();
  await handler({ method, body, query, ...session(who) }, res);
  return res;
};

test.beforeEach(() => {
  pool.calls.length = 0;
  pool.rules.length = 0;
  pool.answer(/FROM sessions/, values => values[0] ? [{ email: 'owner@example.com' }] : []);
  pool.answer(/SELECT owner_email, visibility FROM fighters/, [{ owner_email: 'owner@example.com', visibility: 'private' }]);
  pool.answer(/SELECT visibility FROM fighters WHERE id = \$1 AND owner_email/, [{ visibility: 'private' }]);
  pool.answer(/SELECT id, name, image_data/, [{ id: 'one', body_style: 'shirt', visibility: 'public', mine: false }]);
});

test('roster API adds outfit and account columns to older databases and returns and saves them', async () => {
  const read = await call(fighters, 'GET');
  assert.equal(read.statusCode, 200);
  assert.equal(read.data[0].body_style, 'shirt');
  assert.match(pool.calls[1].sql, /ADD COLUMN IF NOT EXISTS body_style TEXT NOT NULL DEFAULT 'classic'/);
  assert.match(pool.calls[1].sql, /ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'/);
  assert.match(pool.calls[2].sql, /CREATE TABLE IF NOT EXISTS login_codes/);
  assert.match(pool.calls[3].sql, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(pool.last(/SELECT id, name/).sql, /visibility = 'public' OR owner_email = \$1/);
  assert.equal(pool.last(/SELECT id, name/).values[0], null, 'anonymous readers only get public fighters');

  await call(fighters, 'POST', { id: 'one', name: 'Shirt', bodyStyle: 'shirt' }, 'owner');
  assert.equal(pool.last(/INSERT INTO fighters/).values[4], 'shirt');
  assert.equal(pool.last(/INSERT INTO fighters/).values[5], 'owner@example.com');
  await call(fighters, 'POST', { id: 'one', name: 'Older client' }, 'owner');
  assert.equal(pool.last(/INSERT INTO fighters/).values[4], null);
  assert.match(pool.last(/INSERT INTO fighters/).sql, /body_style = COALESCE\(\$5, fighters.body_style\)/, 'older clients preserve the saved outfit');
  assert.equal(pool.calls.filter(c => c.sql.includes('ALTER TABLE')).length, 1);

  const single = await call(fighterById, 'PUT', { name: 'Classic', bodyStyle: 'classic' }, 'owner');
  assert.equal(single.statusCode, 200);
  assert.equal(pool.last(/UPDATE fighters SET name/).values[4], 'classic');
  await call(fighterById, 'PUT', { name: 'Invalid style', bodyStyle: 'unknown' }, 'owner');
  assert.equal(pool.last(/UPDATE fighters SET name/).values[4], null);
});

test('signed-in readers see their own fighters and writes require ownership', async () => {
  await call(fighters, 'GET', null, 'owner');
  assert.equal(pool.last(/SELECT id, name/).values[0], 'owner@example.com');

  const anonymous = await call(fighters, 'POST', { id: 'one', name: 'Nope' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(pool.last(/INSERT INTO fighters/), undefined);

  pool.answer(/SELECT owner_email, visibility FROM fighters/, [{ owner_email: 'someone@else.com', visibility: 'public' }]);
  const stolen = await call(fighters, 'POST', { id: 'one', name: 'Mine now' }, 'owner');
  assert.equal(stolen.statusCode, 403);

  pool.answer(/SELECT owner_email, visibility FROM fighters/, []);
  const created = await call(fighters, 'POST', { id: 'fresh', name: 'New' }, 'owner');
  assert.equal(created.statusCode, 200);
  assert.equal(created.data.visibility, 'private', 'new fighters start private');
  assert.match(pool.last(/INSERT INTO fighters/).sql, /'private'\)/);

  pool.answer(/SELECT visibility FROM fighters WHERE id = \$1 AND owner_email/, []);
  assert.equal((await call(fighterById, 'DELETE', null, 'owner')).statusCode, 403);
  assert.equal((await call(fighterById, 'DELETE', null)).statusCode, 401);
  assert.equal(pool.last(/SET deleted_at = NOW/), undefined);
});

test('editing a public fighter sends it back for approval', async () => {
  pool.answer(/SELECT owner_email, visibility FROM fighters/, [{ owner_email: 'owner@example.com', visibility: 'public' }]);
  const saved = await call(fighters, 'POST', { id: 'one', name: 'Changed' }, 'owner');
  assert.equal(saved.data.visibility, 'pending');
  assert.match(pool.last(/visibility = 'pending'/).sql, /submitted_at = NOW\(\)/);

  pool.answer(/SELECT visibility FROM fighters WHERE id = \$1 AND owner_email/, [{ visibility: 'public' }]);
  const put = await call(fighterById, 'PUT', { name: 'Changed again' }, 'owner');
  assert.equal(put.data.visibility, 'pending');
});

test('a temporary migration error can be retried without losing the roster', async () => {
  let failing = true;
  const flaky = { async query() { if (failing) throw new Error('temporary connection failure'); } };
  await assert.rejects(ensureFighterTable(flaky), /temporary/);
  failing = false;
  await ensureFighterTable(flaky);
});
