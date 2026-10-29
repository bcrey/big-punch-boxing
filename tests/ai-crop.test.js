const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/ai-crop');

function call(method, body) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; } };
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => resolve({ status: res.statusCode, data });
    res.end = () => resolve({ status: res.statusCode });
    handler({ method, body }, res);
  });
}

test('ai-crop rejects bad requests and explains a missing API key', async t => {
  const saved = process.env.ANTHROPIC_API_KEY;
  t.after(() => { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; });
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await call('GET')).status, 405);
  assert.equal((await call('POST', { image: 'abc', mediaType: 'image/gif', width: 10, height: 10 })).status, 400);
  assert.equal((await call('POST', { image: 'abc', mediaType: 'image/jpeg', width: 0, height: 10 })).status, 400);
  const missing = await call('POST', { image: 'abc', mediaType: 'image/jpeg', width: 10, height: 10 });
  assert.equal(missing.status, 503);
  assert.match(missing.data.error, /ANTHROPIC_API_KEY/);
});
