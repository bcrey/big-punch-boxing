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
  for (const file of ['face-crop.js', 'head-outline.js', 'face-outline-editor.js', 'fighter-storage.js']) run(fs.readFileSync(require.resolve('../public/' + file), 'utf8'));
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
