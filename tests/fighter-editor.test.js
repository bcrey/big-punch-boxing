const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { createCanvas, Image, Path2D } = require('@napi-rs/canvas');

const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const rosterCode = html.slice(html.indexOf('// ============ FIGHTER ROSTER SYSTEM'), html.indexOf('// ============ INIT ROSTER'));
const points = [{ x: 50, y: 10 }, { x: 90, y: 40 }, { x: 75, y: 110 }, { x: 50, y: 130 }, { x: 25, y: 110 }, { x: 10, y: 40 }];
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

async function fixture() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://test.invalid/' });
  const window = dom.window;
  const run = code => vm.runInContext(code, dom.getInternalVMContext());
  window.Path2D = Path2D;
  window.Image = Image;
  window.structuredClone = structuredClone;
  window.PaperPunch = { drawBodyPreview() {} };
  window.indexedDB = new IDBFactory();
  window.fetch = async () => ({ ok: false, status: 404 });
  window.requestAnimationFrame = callback => setTimeout(callback, 0);
  const canvases = new WeakMap();
  window.HTMLCanvasElement.prototype.getContext = function () {
    let canvas = canvases.get(this);
    if (!canvas || canvas.width !== this.width || canvas.height !== this.height) {
      canvas = createCanvas(this.width, this.height);
      canvases.set(this, canvas);
    }
    return canvas.getContext('2d');
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return this.id === 'cropArea' ? 252 : 500; } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return this.id === 'cropArea' ? 252 : 500; } });
  window.HTMLElement.prototype.setPointerCapture = function () {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  for (const file of ['face-crop.js', 'head-outline.js', 'face-outline-editor.js', 'camera-capture.js', 'fighter-storage.js', 'account.js']) run(fs.readFileSync(require.resolve('../public/' + file), 'utf8'));
  run('let netMode = "local", onlineConnected = false, previewBoxer1 = null, previewBoxer2 = null; function initPreviewBoxers() {}');
  run(rosterCode);
  const photo = createCanvas(100, 140), context = photo.getContext('2d');
  context.fillStyle = '#dbac85'; context.fillRect(0, 0, 100, 140);
  window.testFighter = { id: 'test-fighter', name: 'Test <fighter>', imageData: photo.toDataURL('image/png'), crop: { sx: 10, sy: 10, sw: 80, sh: 120 } };
  run('roster = [testFighter]; editingFighterId = testFighter.id; rosterApiAvailable = false; renderEditor();');
  await tick();
  return { dom, window, document: window.document, eval: run, click: id => window.document.getElementById(id).click() };
}

test('custom mode detects, supports keyboard/point edits, and restores saved data after reload', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  f.window.testPoints = points;
  f.eval('FaceCrop.detect = async () => [testPoints];');
  f.click('outlineCropMode'); await tick();
  assert.match(f.document.getElementById('outlineStatus').textContent, /Head and hair outlined/);
  assert.equal(f.document.querySelectorAll('.outline-point').length, 6);
  const initialCrop = f.eval('JSON.stringify(computeCropFromEditor())');
  f.click('outlineZoomIn'); f.click('fitOutlineView');
  assert.equal(f.eval('JSON.stringify(computeCropFromEditor())'), initialCrop, 'view zoom must not alter the saved cutout');
  const firstPosition = f.eval('({x: outlineEditor.pan.x + outlineEditor.points[0].x * outlineEditor.zoom, y: outlineEditor.pan.y + outlineEditor.points[0].y * outlineEditor.zoom})');
  const firstHandle = f.document.querySelector('.outline-point');
  firstHandle.dispatchEvent(new f.window.MouseEvent('pointerdown', { clientX: firstPosition.x, clientY: firstPosition.y, button: 0, bubbles: true, cancelable: true }));
  f.document.getElementById('cropArea').dispatchEvent(new f.window.MouseEvent('pointermove', { clientX: firstPosition.x + 5, clientY: firstPosition.y, bubbles: true }));
  f.document.getElementById('cropArea').dispatchEvent(new f.window.MouseEvent('pointerup', { bubbles: true }));
  assert.notEqual(f.eval('JSON.stringify(computeCropFromEditor())'), initialCrop);
  f.click('undoOutline');
  assert.equal(f.eval('JSON.stringify(computeCropFromEditor())'), initialCrop);
  const firstX = f.eval('outlineEditor.points[0].x');
  const handle = f.document.querySelector('.outline-point');
  handle.focus();
  handle.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert(f.eval('outlineEditor.points[0].x') < firstX);
  f.click('undoOutline');
  assert.equal(f.eval('outlineEditor.points[0].x'), firstX);
  f.click('tightenOutline');
  const smaller = f.eval('FaceCrop.bounds(outlineEditor.points).sw');
  f.click('undoOutline');
  assert(f.eval('FaceCrop.bounds(outlineEditor.points).sw') > smaller);

  const edge = f.eval('({x: outlineEditor.pan.x + (outlineEditor.points[0].x + outlineEditor.points[1].x) / 2 * outlineEditor.zoom, y: outlineEditor.pan.y + (outlineEditor.points[0].y + outlineEditor.points[1].y) / 2 * outlineEditor.zoom})');
  f.document.getElementById('cropArea').dispatchEvent(new f.window.MouseEvent('dblclick', { clientX: edge.x, clientY: edge.y, bubbles: true }));
  assert.equal(f.document.querySelectorAll('.outline-point').length, 7);
  f.click('removeOutlinePoint');
  assert.equal(f.document.querySelectorAll('.outline-point').length, 6);
  f.click('undoOutline');
  const expected = f.eval('JSON.stringify(computeCropFromEditor())');
  await f.eval('saveFighter()');
  assert.equal(f.document.getElementById('fighterSaveStatus').textContent, 'Saved on this device.');
  f.eval('roster = [];');
  await f.eval('loadRoster()');
  assert.equal(f.eval('JSON.stringify(roster[0].crop)'), expected);
  f.eval('renderEditor()'); await tick();
  assert.equal(f.document.getElementById('outlineCropMode').getAttribute('aria-pressed'), 'true');
  assert.equal(f.document.querySelectorAll('.outline-point').length, 7);
  f.click('ovalCropMode');
  assert.equal(f.eval('computeCropFromEditor().mode'), 'oval');
  f.click('outlineCropMode');
  assert.equal(f.eval('JSON.stringify(computeCropFromEditor())'), expected);
});

test('detection failure leaves a manually editable outline and Save available', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  f.eval('FaceCrop.detect = async () => { throw new Error("Offline"); };');
  f.click('outlineCropMode'); await tick();
  assert.match(f.document.getElementById('outlineStatus').textContent, /Detection unavailable/);
  assert.equal(f.document.querySelectorAll('.outline-point').length, 18);
  assert.equal(f.document.getElementById('saveFighterButton').disabled, false);
  f.click('tightenOutline');
  await f.eval('saveFighter()');
  assert.equal(f.eval('roster[0].crop.mode'), 'outline');
});

test('no detected face preserves the starting contour and multiple faces can be selected', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  f.eval('FaceCrop.detect = async () => [];');
  f.click('outlineCropMode'); await tick();
  assert.match(f.document.getElementById('outlineStatus').textContent, /No head found/);
  f.window.testPoints = points;
  f.eval('FaceCrop.detect = async () => [testPoints, FaceCrop.resize(testPoints, .5, 100, 140)];');
  f.click('detectOutline'); await tick();
  assert.equal(f.document.getElementById('nextOutlineFace').classList.contains('hidden'), false);
  const first = f.eval('FaceCrop.area(outlineEditor.points)');
  f.click('nextOutlineFace');
  assert(f.eval('FaceCrop.area(outlineEditor.points)') < first);
});

test('late detection cannot overwrite a manual change or a different fighter', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  let resolve;
  f.window.delayedDetection = new Promise(done => { resolve = done; });
  f.eval('FaceCrop.detect = () => delayedDetection;');
  f.click('outlineCropMode'); await tick();
  f.click('tightenOutline');
  const manual = f.eval('JSON.stringify(outlineEditor.points)');
  resolve([points]); await tick();
  assert.equal(f.eval('JSON.stringify(outlineEditor.points)'), manual);

  let resolveSecond;
  f.window.delayedDetection = new Promise(done => { resolveSecond = done; });
  f.click('detectOutline'); await tick();
  f.eval('roster.push({...testFighter, id: "second", name: "Second"}); editingFighterId = "second"; renderEditor();');
  await tick();
  resolveSecond([points]); await tick();
  assert.equal(f.document.getElementById('editorName').value, 'Second');
  assert.equal(f.document.getElementById('ovalCropMode').getAttribute('aria-pressed'), 'true');
  assert.equal(f.document.querySelectorAll('.outline-point').length, 0);
});

test('AI cropping runs the AI tracer, saves an editable outline, and reports failures', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  f.window.testPoints = points;
  f.eval('FaceCrop.detect = async () => { throw new Error("local detector must not run"); }; FaceCrop.detectAI = async () => [testPoints];');
  f.click('aiCropMode'); await tick();
  assert.equal(f.document.getElementById('aiCropMode').getAttribute('aria-pressed'), 'true');
  assert.match(f.document.getElementById('outlineStatus').textContent, /AI outlined the whole head/);
  assert.equal(f.document.getElementById('detectOutline').textContent, 'Redo AI crop');
  assert.equal(f.eval('computeCropFromEditor().mode'), 'outline');
  assert.equal(f.document.querySelectorAll('.outline-point').length, 6);

  f.eval('FaceCrop.detectAI = async () => { throw new Error("AI cropping is not set up on the server yet."); };');
  f.click('detectOutline'); await tick();
  assert.match(f.document.getElementById('outlineStatus').textContent, /not set up.*drag the points by hand/);
  assert.equal(f.document.querySelectorAll('.outline-point').length, 6, 'a failed retry keeps the previous outline');
});

test('Take photo opens a live viewfinder, stops the camera on close, and loads the captured shot', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  const stopped = [];
  Object.defineProperty(f.window, 'isSecureContext', { value: true });
  Object.defineProperty(f.window.navigator, 'mediaDevices', { value: {
    getUserMedia: async constraints => {
      f.window.lastConstraints = constraints;
      return { getTracks: () => [{ stop: () => stopped.push(constraints.video.facingMode) }] };
    },
    enumerateDevices: async () => [{ kind: 'videoinput' }, { kind: 'videoinput' }]
  } });
  f.window.HTMLMediaElement.prototype.play = async () => {};
  f.click('takePhotoButton'); await tick();
  const view = f.document.querySelector('#cropStage .camera-view');
  assert(view, 'viewfinder opens over the crop area');
  assert.equal(f.window.lastConstraints.video.facingMode, 'user');
  assert.equal(view.querySelector('.camera-shutter').disabled, false);
  assert.equal(view.querySelector('.camera-flip').hidden, false, 'flip shows when there are two cameras');
  view.querySelector('.camera-flip').click(); await tick();
  assert.deepEqual(stopped, ['user']);
  assert.equal(f.window.lastConstraints.video.facingMode, 'environment');
  f.eval('drawCropPreview()');
  assert(f.document.querySelector('.camera-view'), 'crop redraws must not remove the viewfinder');
  view.querySelector('.camera-cancel').click(); await tick();
  assert.equal(f.document.querySelector('.camera-view'), null);
  assert.deepEqual(stopped, ['user', 'environment']);

  f.window.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  f.click('takePhotoButton'); await tick();
  assert.equal(f.document.querySelector('.camera-view'), null);
  assert.match(f.document.getElementById('fighterSaveStatus').textContent, /Camera access was blocked/);

  const shot = f.eval('testFighter.imageData');
  f.eval('CameraCapture.open = () => ({ done: Promise.resolve(testFighter.imageData), close() {} }); cropImg = null;');
  f.click('takePhotoButton'); await tick(); await tick();
  assert.equal(f.eval('cropImgData'), shot);
  assert.equal(f.eval('computeCropFromEditor().sw > 0'), true);
});

test('Take photo falls back to the device camera picker without live camera support', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  let picked = false;
  f.document.getElementById('managerCamera').click = () => { picked = true; };
  f.click('takePhotoButton');
  assert.equal(picked, true);
  assert.equal(f.document.getElementById('managerCamera').getAttribute('capture'), 'user');
});

test('outfits are chosen explicitly, survive recropping and storage, and reach both player slots', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  assert.equal(f.document.getElementById('classicBodyStyle').getAttribute('aria-pressed'), 'true', 'legacy fighters keep their outfit');
  f.click('shirtBodyStyle');
  f.window.testPoints = points;
  f.eval('FaceCrop.detect = async () => [testPoints];');
  f.click('outlineCropMode'); await tick();
  await f.eval('saveFighter()');
  f.eval('roster = [];');
  await f.eval('loadRoster()');
  assert.equal(f.eval('roster[0].bodyStyle'), 'shirt');
  await f.eval('selectFighter(1, roster[0].id);');
  await f.eval('selectFighter(2, roster[0].id);');
  assert.equal(f.eval('bodyStyles[1]'), 'shirt');
  assert.equal(f.eval('bodyStyles[2]'), 'shirt');
  f.eval('renderEditor()'); await tick();
  assert.equal(f.document.getElementById('shirtBodyStyle').getAttribute('aria-pressed'), 'true');
  f.click('classicBodyStyle');
  f.click('detectOutline'); await tick();
  assert.equal(f.document.getElementById('classicBodyStyle').getAttribute('aria-pressed'), 'true', 'head scanning cannot override the outfit choice');
  await f.eval('saveFighter()');
  assert.equal(f.eval('roster[0].bodyStyle'), 'classic');
});

test('new fighters default to a shirt even without a photo, and API saves carry the outfit', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  f.eval('addNewFighter()');
  assert.equal(f.document.getElementById('shirtBodyStyle').getAttribute('aria-pressed'), 'true');
  f.eval('rosterApiAvailable = true;');
  await f.eval('saveFighter()');
  assert.match(f.document.getElementById('fighterSaveStatus').textContent, /sign-in expired/i, 'online saves need a session');
  f.window.fetch = async () => ({ ok: true, json: async () => ({ token: 't'.repeat(43), email: 'fan@example.com' }) });
  await f.eval('Account.verify("fan@example.com", "123456")');
  let payload, auth;
  f.window.fetch = async (url, options) => { payload = JSON.parse(options.body); auth = options.headers.Authorization; return { ok: true, json: async () => ({ ok: true, visibility: 'private' }) }; };
  f.eval('showManager(); editingFighterId = roster.at(-1).id; renderEditor();');
  await f.eval('saveFighter()');
  assert.equal(auth, 'Bearer ' + 't'.repeat(43));
  assert.equal(payload.bodyStyle, 'shirt');
  assert.equal(payload.imageData, null);
  assert.equal(payload.crop, null);
  f.window.fetch = async () => ({ ok: true, json: async () => [{ id: payload.id, name: 'Remote', body_style: 'shirt', crop: null, image_data: null }] });
  await f.eval('loadRoster()');
  assert.equal(f.eval('roster[0].bodyStyle'), 'shirt');
});

test('with the API online the manager asks for a sign-in code, then shows your fighters apart from public ones', async t => {
  const f = await fixture(); t.after(() => f.dom.window.close());
  const requests = [];
  const rows = [
    { id: 'pub', name: 'Champ', image_data: null, crop: null, body_style: 'classic', visibility: 'public', mine: false },
    { id: 'me', name: 'Me', image_data: f.window.testFighter.imageData, crop: { sx: 10, sy: 10, sw: 80, sh: 120 }, body_style: 'shirt', visibility: 'private', mine: true }
  ];
  f.window.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body, auth: options.headers?.Authorization });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (url === '/api/auth' && body.action === 'request-code') return body.email.includes('@') ? reply(200, { ok: true }) : reply(400, { error: 'Enter a valid email address.' });
    if (url === '/api/auth' && body.action === 'verify') return body.code === '123456' ? reply(200, { token: 't'.repeat(43), email: body.email }) : reply(401, { error: 'That code is wrong or has expired. Request a new one.' });
    if (url === '/api/fighters' && !options.method) return reply(200, rows);
    if (url === '/api/fighters') return reply(200, { ok: true, visibility: 'private' });
    if (url === '/api/publish') return reply(200, { ok: true, visibility: body.action === 'request' ? 'pending' : 'private' });
    return reply(404, {});
  };
  f.eval('rosterApiAvailable = true; roster = []; editingFighterId = null;');
  f.eval('openManager()');
  assert.equal(f.document.getElementById('signinPanel').classList.contains('hidden'), false, 'signed-out players see the sign-in card');
  assert.equal(f.document.getElementById('managerContent').classList.contains('hidden'), true);

  f.document.getElementById('signinEmail').value = 'fan@example.com';
  f.document.getElementById('signinEmailForm').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await tick();
  assert.match(f.document.getElementById('signinStatus').textContent, /Check fan@example.com for a 6-digit code/);
  assert.equal(f.document.getElementById('signinCodeForm').classList.contains('hidden'), false);

  f.document.getElementById('signinCode').value = '999999';
  f.document.getElementById('signinCodeForm').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await tick();
  assert.match(f.document.getElementById('signinStatus').textContent, /wrong or has expired/);

  f.document.getElementById('signinCode').value = '123456';
  f.document.getElementById('signinCodeForm').dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await tick(); await tick();
  assert.equal(f.document.getElementById('managerContent').classList.contains('hidden'), false);
  assert.equal(f.eval('Account.email'), 'fan@example.com');
  assert.equal(requests.find(r => r.url === '/api/fighters').auth, 'Bearer ' + 't'.repeat(43), 'the roster is fetched with the session');
  assert.match(f.document.getElementById('accountBar').textContent, /Signed in as fan@example.com/);
  assert.equal(f.document.querySelectorAll('#rosterList .roster-item').length, 1);
  assert.equal(f.document.querySelectorAll('#publicList .roster-item').length, 1);
  assert.equal(f.document.querySelector('#publicList .roster-delete'), null, 'public fighters cannot be deleted by players');

  f.document.querySelector('#rosterList .roster-item').click();
  await tick();
  const publishButton = f.document.getElementById('publishButton');
  assert.equal(publishButton.textContent, 'Publish to everyone');
  publishButton.click();
  await tick(); await tick();
  assert.deepEqual(requests.at(-1).body, { id: 'me', action: 'request' });
  assert.equal(requests.at(-1).auth, 'Bearer ' + 't'.repeat(43));
  assert.match(f.document.getElementById('fighterSaveStatus').textContent, /Sent for approval/);
  assert.equal(f.document.getElementById('publishButton').textContent, 'Withdraw');
  assert.match(f.document.querySelector('#rosterList .roster-badge').textContent, /Waiting for approval/);

  f.eval('editingFighterId = "pub"; renderEditor();');
  assert.match(f.document.getElementById('editorPanel').textContent, /Only its owner can change it/);
});
