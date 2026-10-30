// A pg Pool stand-in: records every query and answers from regex rules set per test.
function fakePool(rules = []) {
  const calls = [];
  return {
    calls,
    rules,
    answer(pattern, rows) { rules.unshift([pattern, rows]); return this; },
    async query(sql, values) {
      calls.push({ sql, values });
      for (const [pattern, rows] of rules) {
        if (pattern.test(sql)) return { rows: typeof rows === 'function' ? rows(values, sql) : rows };
      }
      return { rows: [] };
    },
    last: pattern => [...calls].reverse().find(c => pattern.test(c.sql))
  };
}

function response() {
  return {
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
}

// Loads an API handler with lib/db pointed at the fake pool. Call before requiring handlers.
function useFakePool(pool) {
  const path = require.resolve('../lib/db');
  require.cache[path] = { id: path, filename: path, loaded: true, exports: { getPool: () => pool } };
}

module.exports = { fakePool, response, useFakePool };
