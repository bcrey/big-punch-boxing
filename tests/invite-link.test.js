const test = require('node:test');
const assert = require('node:assert/strict');
const { gameFixture } = require('./game-fixture');

test('hosting shows a copy button that copies a link, and opening that link joins the room', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  const { window } = f, doc = window.document;
  const peers = [];
  window.Peer = class {
    constructor(id) { this.id = id; this.handlers = {}; this.connected = []; peers.push(this); }
    on(event, handler) { this.handlers[event] = handler; }
    connect(id) { this.connected.push(id); return { on() {} }; }
    destroy() {}
  };
  let copied = null;
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });

  f.eval('showLobby(); createRoom();');
  const code = doc.getElementById('roomCodeDisplay').textContent;
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert.equal(peers[0].id, 'bambam-' + code);
  assert.equal(doc.getElementById('copyInviteBtn').textContent, 'CLICK TO COPY LINK');
  assert.equal(doc.getElementById('inviteLinkText').textContent, 'test.invalid/?join=' + code);

  assert.equal(doc.getElementById('copyInviteBtn').getAttribute('onclick'), 'copyRoomCode()');
  f.eval('copyRoomCode()');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, 'http://test.invalid/?join=' + code, 'the whole link is copied, not the bare code');
  assert.equal(doc.getElementById('copyInviteBtn').textContent, 'COPIED!');
  assert.match(doc.getElementById('roomCodeCopied').textContent, /Link copied/);

  f.eval('hideLobby()');
  assert.equal(f.eval('joinFromInviteLink()'), false, 'a normal visit does nothing');
  window.history.replaceState(null, '', '/?join=' + code.toLowerCase());
  assert.equal(f.eval('joinFromInviteLink()'), true);
  assert.equal(window.location.search, '', 'the invite is consumed so a refresh does not rejoin');
  const guest = peers.at(-1);
  guest.handlers.open();
  assert.deepEqual(guest.connected, ['bambam-' + code]);
  assert.equal(doc.getElementById('lobbyOverlay').classList.contains('hidden'), false);

  window.history.replaceState(null, '', '/?join=%3Cscript%3E');
  assert.equal(f.eval('joinFromInviteLink()'), false, 'junk in the link is ignored');
});

test('analytics loads only on the live site and counts fights', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  assert.equal(f.window.document.querySelector('script[src*="googletagmanager"]'), null, 'no tag off box.bcr.co');
  assert.equal(f.window.document.querySelector('script[src*="clarity.ms"]'), null, 'no Clarity off box.bcr.co');
  f.eval('dataLayer.length = 0; round = 1; startCountdown(); round = 2; startCountdown();');
  const events = f.eval('dataLayer.map(a => [a[0], a[1], a[2] && a[2].mode].join(":"))');
  assert.deepEqual([...events], ['event:fight_start:local'], 'one event per fight, not per round');
});
