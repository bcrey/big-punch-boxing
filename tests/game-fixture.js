const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { createCanvas, Image, Path2D } = require('@napi-rs/canvas');
const { IDBFactory } = require('fake-indexeddb');

async function gameFixture() {
  const root = path.resolve(__dirname, '../public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://test.invalid/' });
  const window = dom.window;
  const run = code => vm.runInContext(code, dom.getInternalVMContext());
  window.Image = class extends Image {
    set src(value) { super.src = value.startsWith('assets/') ? path.join(root, value) : value; }
    get src() { return super.src; }
  };
  window.Path2D = Path2D;
  window.structuredClone = structuredClone;
  window.indexedDB = new IDBFactory();
  window.requestAnimationFrame = () => 1;
  window.setTimeout = () => 1;
  const media = { matches: false, addEventListener(event, callback) { this.onchange = callback; } };
  window.matchMedia = () => media;
  window.fetch = async () => ({ ok: true, json: async () => [
    { id: 'one', name: 'Red', image_data: null, crop: null, body_style: 'shirt' },
    { id: 'two', name: 'Blue', image_data: null, crop: null, body_style: 'classic' }
  ] });
  const canvases = new WeakMap();
  window.HTMLCanvasElement.prototype.getContext = function () {
    let canvas = canvases.get(this);
    if (!canvas || canvas.width !== this.width || canvas.height !== this.height) {
      canvas = createCanvas(this.width, this.height); canvases.set(this, canvas);
      const context = canvas.getContext('2d');
      for (const method of ['drawImage', 'createPattern']) {
        const original = context[method].bind(context);
        context[method] = (image, ...args) => original(canvases.get(image) || image, ...args);
      }
    }
    return canvas.getContext('2d');
  };
  for (const file of ['face-crop.js', 'head-outline.js', 'face-outline-editor.js', 'camera-capture.js', 'fighter-storage.js', 'account.js', 'paper-punch.js', 'arcade-effects.js']) {
    run(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) run(script[1]);
  await new Promise(resolve => setTimeout(resolve, 30));
  return { dom, window, eval: run, media, canvas: id => canvases.get(window.document.getElementById(id)) };
}

module.exports = { gameFixture };
