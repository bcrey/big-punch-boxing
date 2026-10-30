// The admin's emailed review page: GET shows the fighter, POST records the decision.
const { getPool } = require('../lib/db');
const { ensureFighterTable } = require('../lib/fighter-schema');
const { readReviewToken } = require('../lib/auth');
const { loadFighter, decide } = require('../lib/review');

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · Bam Bam Boxing</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#142638; font-family:Arial,sans-serif; }
  main { width:min(440px,calc(100% - 32px)); margin:24px 0; padding:28px 30px; background:#f3e5c9; color:#142638; }
  .kicker { font:bold 12px 'Courier New',monospace; letter-spacing:3px; color:#bb3d36; }
  h1 { font:bold 28px Impact,'Arial Black',sans-serif; letter-spacing:1px; margin:12px 0 16px; }
  p { font-size:15px; line-height:1.5; margin:0 0 12px; }
  .photo { display:block; max-width:100%; max-height:360px; margin:0 auto 16px; background:#dfc6a0; }
  .actions { display:flex; gap:10px; margin-top:18px; }
  button { flex:1; padding:14px; border:0; font:bold 15px Arial,sans-serif; color:#f3e5c9; cursor:pointer; }
  .approve { background:#31658e; } .reject { background:#bb3d36; } button:disabled { opacity:.6; cursor:default; }
  .note { font-size:12px; color:#5a4e3c; margin-top:14px; }
  #result { margin-top:14px; font-weight:bold; min-height:20px; }
</style></head><body><main><div class="kicker">&#9733; BAM BAM BOXING</div><h1>${escape(title)}</h1>${body}</main></body></html>`;
}

const html = (res, status, title, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(page(title, body));
};

module.exports = async function handler(req, res) {
  const p = getPool();
  try {
    await ensureFighterTable(p);
    if (req.method === 'GET') {
      const id = readReviewToken(req.query?.token);
      if (!id) return html(res, 403, 'Link expired', '<p>This review link is not valid any more. Open the admin panel in the game to review pending fighters.</p>');
      const fighter = await loadFighter(p, id);
      if (!fighter) return html(res, 404, 'Fighter not found', '<p>This fighter was deleted.</p>');
      const status = { pending: 'waiting for your approval', public: 'already public', private: 'private again (the owner withdrew it)', rejected: 'already rejected' }[fighter.visibility];
      const photo = fighter.image_data && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(fighter.image_data)
        ? `<img class="photo" src="${fighter.image_data}" alt="Photo for ${escape(fighter.name)}">` : '<p><i>No photo.</i></p>';
      const buttons = fighter.visibility === 'pending' ? `
        <div class="actions"><button class="approve" data-decision="approve">Approve</button><button class="reject" data-decision="reject">Reject</button></div>
        <div id="result" role="status"></div>
        <script>
          const token = ${JSON.stringify(req.query.token)};
          document.querySelectorAll('button').forEach(button => button.onclick = async () => {
            document.querySelectorAll('button').forEach(b => b.disabled = true);
            const result = document.getElementById('result');
            result.textContent = 'Saving…';
            try {
              const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, decision: button.dataset.decision }) });
              const data = await response.json();
              result.textContent = response.ok ? (data.visibility === 'public' ? 'Approved. It is in the public roster now.' : 'Rejected. The owner has been told.') : data.error;
            } catch (e) { result.textContent = 'Could not save. Try again.'; document.querySelectorAll('button').forEach(b => b.disabled = false); }
          });
        </script>` : '';
      return html(res, 200, fighter.name, `
        <p><b>${escape(fighter.owner_email)}</b> wants to publish this fighter. It is ${status}.</p>
        ${photo}${buttons}
        <p class="note">Approving puts it in the roster every player sees. Rejecting keeps it in the owner's private list.</p>`);
    }

    if (req.method === 'POST') {
      const { token, decision } = req.body || {};
      const id = readReviewToken(token);
      if (!id) return res.status(403).json({ error: 'This review link is not valid any more.' });
      if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Unknown decision' });
      const fighter = await loadFighter(p, id);
      if (!fighter) return res.status(404).json({ error: 'Fighter not found' });
      if (fighter.visibility !== 'pending') return res.status(409).json({ error: `This fighter is no longer waiting for review (it is ${fighter.visibility}).` });
      await decide(p, fighter, decision === 'approve');
      return res.status(200).json({ ok: true, visibility: decision === 'approve' ? 'public' : 'rejected' });
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).end();
  } catch (err) {
    console.error('review API error:', err);
    res.status(500).json({ error: err.message });
  }
};
