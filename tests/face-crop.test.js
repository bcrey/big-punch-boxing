const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, Path2D } = require('@napi-rs/canvas');
const FaceCrop = require('../public/face-crop');
global.Path2D = Path2D;

const contour = [{ x: 50, y: 10 }, { x: 90, y: 40 }, { x: 75, y: 110 }, { x: 50, y: 130 }, { x: 25, y: 110 }, { x: 10, y: 40 }];

test('a saved custom outline is tight, independent of the editor view, and survives JSON', () => {
  const crop = FaceCrop.fromOutline(contour);
  assert.deepEqual([crop.sx, crop.sy, crop.sw, crop.sh], [10, 10, 80, 120]);
  assert.equal(crop.ovalRatio, 2 / 3);
  const saved = JSON.parse(JSON.stringify(crop));
  assert.equal(FaceCrop.isOutline(saved), true);
  assert.deepEqual(saved.outline, contour);
  crop.outline[0].x = 0;
  assert.equal(contour[0].x, 50, 'saving must not retain references to live handles');
});

test('outline clipping removes background pixels and preserves source alignment', () => {
  const photo = createCanvas(100, 140), photoContext = photo.getContext('2d');
  photoContext.fillStyle = '#ff0000'; photoContext.fillRect(0, 0, 100, 140);
  photoContext.fillStyle = '#0000ff'; photoContext.fillRect(50, 0, 50, 140);
  const output = createCanvas(160, 240), context = output.getContext('2d');
  FaceCrop.draw(context, photo, FaceCrop.fromOutline(contour), 0, 0, 160, 240);
  const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data);
  assert.equal(pixel(0, 0)[3], 0, 'background outside the custom forehead must be transparent');
  assert.equal(pixel(0, 239)[3], 0, 'background outside the custom jaw must be transparent');
  assert.deepEqual(pixel(60, 100), [255, 0, 0, 255]);
  assert.deepEqual(pixel(100, 100), [0, 0, 255, 255]);
});

test('legacy crop rectangles continue to use an oval mask', () => {
  const photo = createCanvas(100, 140), source = photo.getContext('2d');
  source.fillStyle = 'red'; source.fillRect(0, 0, 100, 140);
  const output = createCanvas(80, 120), context = output.getContext('2d');
  FaceCrop.draw(context, photo, { sx: 10, sy: 10, sw: 80, sh: 120 }, 0, 0, 80, 120);
  assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0);
  assert.equal(context.getImageData(40, 60, 1, 1).data[3], 255);
});

test('crossed, tiny, and non-finite contours are rejected without rejecting winding direction', () => {
  assert.equal(FaceCrop.valid([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 80, y: 0 }]), false);
  assert.equal(FaceCrop.fromOutline([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]), null);
  assert.equal(FaceCrop.valid([...contour, { x: NaN, y: 1 }]), false);
  assert.equal(FaceCrop.valid([...contour].reverse()), true);
});

test('manual sizing respects image bounds and off-photo oval positions have a usable fallback', () => {
  const wider = FaceCrop.resize(contour, 10, 100, 140);
  assert(wider.every(point => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 140));
  assert(FaceCrop.valid(FaceCrop.ellipse({ sx: -500, sy: -500, sw: 20, sh: 20 }, 100, 140)));
  const tighter = FaceCrop.resize(contour, .96, 100, 140);
  assert(FaceCrop.area(tighter) < FaceCrop.area(contour));
});

test('adding a point projects onto the selected edge without changing the cutout', () => {
  const edge = FaceCrop.nearestEdge(contour, { x: 72, y: 23 });
  assert.equal(edge.index, 0);
  const updated = FaceCrop.copy(contour);
  updated.splice(edge.index + 1, 0, edge.point);
  assert(FaceCrop.valid(updated));
  assert(Math.abs(FaceCrop.area(updated) - FaceCrop.area(contour)) < .00001);
});
