/* Email-code sign in for adding your own fighters. The session token lives in localStorage. */
const Account = (() => {
  const KEY = 'bbbAccount';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { session = null; }
  if (!session?.token || !session?.email) session = null;

  function store(next) {
    session = next;
    try { next ? localStorage.setItem(KEY, JSON.stringify(next)) : localStorage.removeItem(KEY); } catch (_) { /* private mode */ }
  }

  async function call(body, headers = {}) {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  return {
    get email() { return session?.email || null; },
    get signedIn() { return !!session; },
    // Spread into fetch headers; empty when signed out.
    headers() { return session ? { Authorization: `Bearer ${session.token}` } : {}; },
    requestCode: email => call({ action: 'request-code', email }),
    async verify(email, code) {
      const data = await call({ action: 'verify', email, code });
      store({ token: data.token, email: data.email });
      return data.email;
    },
    async signOut() {
      const headers = this.headers();
      store(null);
      try { await call({ action: 'logout' }, headers); } catch (_) { /* the token is gone locally either way */ }
    },
    // Called when the server no longer accepts the token.
    forget() { store(null); }
  };
})();

if (typeof module !== 'undefined') module.exports = Account;
