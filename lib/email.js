// Outbound mail through Resend's REST API. bcr.co is a verified sending domain.
const FROM = process.env.MAIL_FROM || 'Bam Bam Boxing <fight@bcr.co>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'brian@teveyo.com';
const SITE_URL = process.env.SITE_URL || 'https://box.bcr.co';

const configured = () => !!process.env.RESEND_API_KEY;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#142638;font-family:Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#f3e5c9;color:#142638;padding:28px 30px">
    <div style="font:bold 12px 'Courier New',monospace;letter-spacing:3px;color:#bb3d36">&#9733; BAM BAM BOXING</div>
    <h1 style="font:bold 26px Impact,'Arial Black',sans-serif;margin:14px 0 18px;letter-spacing:1px">${escape(title)}</h1>
    ${body}
  </div></body></html>`;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!configured()) throw new Error('RESEND_API_KEY is not set');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text, reply_to: replyTo })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response.json();
}

function loginCode(to, code) {
  return send({
    to,
    subject: `${code} is your Bam Bam Boxing code`,
    text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for it, ignore this email.`,
    html: layout('Your sign-in code', `
      <p style="margin:0 0 12px;font-size:15px">Enter this code in the game to add your own fighters:</p>
      <div style="display:inline-block;padding:10px 22px;background:#142638;color:#f3e5c9;font:bold 34px 'Courier New',monospace;letter-spacing:8px">${code}</div>
      <p style="margin:16px 0 0;font-size:12px;color:#5a4e3c">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>`)
  });
}

function reviewRequest({ fighter, ownerEmail, token }) {
  const link = token ? `${SITE_URL}/api/review?token=${encodeURIComponent(token)}` : null;
  const action = link
    ? `<p style="margin:18px 0 0"><a href="${link}" style="display:inline-block;padding:12px 22px;background:#31658e;color:#f3e5c9;text-decoration:none;font:bold 14px Arial,sans-serif">Review this fighter</a></p>
       <p style="margin:12px 0 0;font-size:12px;color:#5a4e3c">The link works for 14 days. You can also approve it from the admin panel in the game.</p>`
    : `<p style="margin:18px 0 0;font-size:13px">Open the admin panel in the game to approve or reject it.</p>`;
  return send({
    to: ADMIN_EMAIL,
    replyTo: ownerEmail,
    subject: `Fighter waiting for approval: ${fighter.name}`,
    text: `${ownerEmail} wants to publish "${fighter.name}" to everyone.\n\n${link ? 'Review it: ' + link : 'Approve it in the game admin panel.'}`,
    html: layout('A fighter wants in', `
      <p style="margin:0;font-size:15px"><b>${escape(ownerEmail)}</b> wants to publish <b>${escape(fighter.name)}</b> to everyone.</p>
      ${action}`)
  });
}

function reviewResult({ fighter, ownerEmail, approved }) {
  return send({
    to: ownerEmail,
    subject: approved ? `${fighter.name} is now in the public roster` : `${fighter.name} wasn't approved`,
    text: approved
      ? `Your fighter "${fighter.name}" was approved and is now available to everyone at ${SITE_URL}.`
      : `Your fighter "${fighter.name}" wasn't approved for the public roster. It is still available in your own fighters.`,
    html: layout(approved ? 'Approved!' : 'Not this time', approved
      ? `<p style="margin:0;font-size:15px">Your fighter <b>${escape(fighter.name)}</b> is now in the public roster. Everyone can pick it at <a href="${SITE_URL}" style="color:#31658e">${SITE_URL.replace(/^https?:\/\//, '')}</a>.</p>`
      : `<p style="margin:0;font-size:15px">Your fighter <b>${escape(fighter.name)}</b> wasn't approved for the public roster. It is still there in your own fighters, and you can change it and ask again.</p>`)
  });
}

module.exports = { configured, send, loginCode, reviewRequest, reviewResult, ADMIN_EMAIL, SITE_URL };
