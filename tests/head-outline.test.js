const test = require('node:test');
const assert = require('node:assert/strict');
const HeadOutline = require('../public/head-outline');
const FaceCrop = require('../public/face-crop');

function photo(width = 120, height = 160) {
  const data = new Uint8Array(width * height);
  return {
    data, width, height,
    ellipse(cx, cy, rx, ry, category) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) data[y * width + x] = category;
      }
    },
    rect(x, y, w, h, category) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data[yy * width + xx] = category;
    },
    heads() { return HeadOutline.extract(data, width, height, width, height); }
  };
}

function includes(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

test('head outline includes a high bun and ears, while leaving neck, hands and clothes out', () => {
  const image = photo();
  image.rect(50, 120, 20, 25, 2); // Neck
  image.rect(10, 145, 100, 15, 4); // Shirt
  image.ellipse(12, 100, 8, 16, 2); // Hand beside the head
  image.ellipse(60, 55, 33, 24, 1); // Hair
  image.ellipse(84, 25, 20, 22, 1); // Bun above and to one side
  image.ellipse(60, 90, 25, 35, 3); // Face
  image.ellipse(32, 90, 6, 10, 3); // Ear
  const [head] = image.heads();
  assert(head && FaceCrop.valid(head));
  assert(head.length <= 40, 'silhouette must remain practical to edit');
  assert(includes(head, 84, 10), 'bun above the forehead must be included');
  assert(includes(head, 60, 44), 'hair must be included');
  assert(includes(head, 30, 90), 'ear must be included');
  assert(includes(head, 60, 95));
  assert(!includes(head, 60, 138), 'neck must be excluded');
  assert(!includes(head, 12, 100), 'hand must be excluded');
  assert(!includes(head, 60, 154), 'clothes must be excluded');
});

test('long hair keeps its shape below the chin instead of becoming an enlarged face oval', () => {
  const image = photo();
  image.ellipse(60, 48, 35, 30, 1);
  image.rect(25, 47, 15, 102, 1);
  image.rect(81, 47, 15, 102, 1);
  image.ellipse(60, 85, 26, 34, 3);
  image.rect(50, 118, 20, 40, 2);
  const [head] = image.heads();
  assert(FaceCrop.valid(head));
  assert(includes(head, 30, 142));
  assert(includes(head, 88, 142));
  assert(!includes(head, 60, 140), 'the gap between long hair should not include the neck');
});

test('separate heads remain separate choices and isolated hair-colored noise is ignored', () => {
  const image = photo(160, 100);
  image.ellipse(40, 30, 24, 24, 1);
  image.ellipse(40, 53, 18, 24, 3);
  image.ellipse(120, 35, 20, 20, 1);
  image.ellipse(120, 55, 15, 22, 3);
  image.rect(78, 10, 3, 3, 1);
  const heads = image.heads();
  assert.equal(heads.length, 2);
  assert(heads.every(FaceCrop.valid));
  assert(heads.some(head => includes(head, 40, 40) && !includes(head, 120, 40)));
  assert(heads.some(head => includes(head, 120, 40) && !includes(head, 40, 40)));
});

test('bald heads and hair touching the photo edge produce valid, correctly scaled outlines', () => {
  const image = photo();
  image.ellipse(60, 50, 35, 45, 3);
  let [head] = image.heads();
  assert(FaceCrop.valid(head));
  assert(includes(head, 60, 10));
  image.ellipse(60, 5, 35, 25, 1);
  [head] = HeadOutline.extract(image.data, image.width, image.height, 240, 320);
  assert.equal(FaceCrop.bounds(head).sy, 0);
  assert(includes(head, 120, 10));
  assert(head.every(point => point.x >= 0 && point.x <= 240 && point.y >= 0 && point.y <= 320));
});

test('empty masks do not claim to have found a head', () => {
  assert.deepEqual(photo().heads(), []);
});

test('glasses remain part of the head while an accessory below the chin stays out', () => {
  const image = photo();
  image.ellipse(60, 60, 30, 45, 3);
  image.rect(30, 50, 50, 5, 5); // Glasses arm and frame crossing the temple
  image.rect(45, 106, 30, 30, 5); // Necklace below the chin
  const [head] = image.heads();
  assert(FaceCrop.valid(head));
  assert(includes(head, 32, 52), 'glasses must not leave a slit through the temple');
  assert(!includes(head, 60, 120), 'necklaces are not part of the head');
});
