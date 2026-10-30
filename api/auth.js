const { getPool } = require('../lib/db');
const { ensureFighterTable } = require('../lib/fighter-schema');
const auth = require('../lib/auth');
const email = require('../lib/email');

module.exports = async function handler(req, res) {
  const p = getPool();
  try {
    await ensureFighterTable(p);
    if (req.method === 'GET') {
      const session = await auth.getSession(req, p);
      return session ? res.status(200).json({ email: session.email }) : res.status(401).json({ error: 'Not signed in.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).end();
    }
    const { action } = req.body || {};
    const address = auth.normalizeEmail(req.body?.email);

    if (action === 'request-code') {
      if (!auth.validEmail(address)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (!email.configured()) return res.status(503).json({ error: 'Sign-in email is not set up on the server yet.' });
      const code = await auth.issueCode(p, address);
      if (!code) return res.status(429).json({ error: 'Too many codes requested. Check your inbox, or try again in 15 minutes.' });
      try {
        await email.loginCode(address, code);
      } catch (error) {
        console.error('login code email failed:', error.message);
        return res.status(502).json({ error: 'Could not send the code. Try again in a moment.' });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'verify') {
      const code = String(req.body?.code || '').replace(/\D/g, '');
      if (!auth.validEmail(address) || code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
      const token = await auth.redeemCode(p, address, code);
      if (!token) return res.status(401).json({ error: 'That code is wrong or has expired. Request a new one.' });
      return res.status(200).json({ token, email: address });
    }

    if (action === 'logout') {
      const session = await auth.getSession(req, p);
      await auth.endSession(p, session?.token);
      return res.status(200).json({ ok: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('auth API error:', err);
    res.status(500).json({ error: err.message });
  }
};
