const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ensureFighterTable } = require('../lib/fighter-schema');

function endpoint(file) {
  const calls = [];
  class Pool {
    async query(sql, values) { calls.push({ sql, values }); return { rows: [{ id: 'one', body_style: 'shirt' }] }; }
  }
  const context = {
    module: { exports: {} }, process: { env: {} }, console,
    require: name => name === 'pg' ? { Pool } : { ensureFighterTable }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), context);
  return {
    calls,
    async call(method, body) {
      const res = { status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; }, setHeader() {}, end() {} };
      await context.module.exports({ method, body, query: { id: 'one' } }, res);
      return res;
    }
  };
}

test('roster API adds outfit support to older databases and returns and saves it', async () => {
  const api = endpoint('../api/fighters.js');
  const read = await api.call('GET');
  assert.equal(read.statusCode, 200);
  assert.equal(read.data[0].body_style, 'shirt');
  assert.match(api.calls[1].sql, /ADD COLUMN IF NOT EXISTS body_style TEXT NOT NULL DEFAULT 'classic'/);
  assert.match(api.calls[2].sql, /SELECT.*body_style/);
  await api.call('POST', { id: 'one', name: 'Shirt', bodyStyle: 'shirt' });
  assert.equal(api.calls.at(-1).values[4], 'shirt');
  await api.call('POST', { id: 'one', name: 'Older client' });
  assert.equal(api.calls.at(-1).values[4], null);
  assert.match(api.calls.at(-1).sql, /body_style = COALESCE\(\$5, fighters.body_style\)/, 'older clients preserve the saved outfit');
  assert.equal(api.calls.filter(c => c.sql.includes('ALTER TABLE')).length, 1);
  const single = endpoint('../api/fighters/[id].js');
  await single.call('PUT', { name: 'Classic', bodyStyle: 'classic' });
  assert.equal(single.calls.at(-1).values[4], 'classic');
  await single.call('PUT', { name: 'Invalid style', bodyStyle: 'unknown' });
  assert.equal(single.calls.at(-1).values[4], null);
});

test('a temporary migration error can be retried without losing the roster', async () => {
  let failing = true;
  const pool = { async query() { if (failing) throw new Error('temporary connection failure'); } };
  await assert.rejects(ensureFighterTable(pool), /temporary/);
  failing = false;
  await ensureFighterTable(pool);
});
