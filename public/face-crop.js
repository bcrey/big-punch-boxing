/* Shared crop geometry. Outline coordinates stay in original-image pixels. */
const FaceCrop = (() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const copy = points => points.map(p => ({ x: p.x, y: p.y }));

  function bounds(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const sx = Math.min(...xs), sy = Math.min(...ys);
    return { sx, sy, sw: Math.max(...xs) - sx, sh: Math.max(...ys) - sy };
  }

  function area(points) {
    return Math.abs(points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0)) / 2;
  }

  function valid(points) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 80 ||
        points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) || area(points) < 4) return false;
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue;
        const c = points[j], d = points[(j + 1) % points.length];
        if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
      }
    }
    return true;
  }

  function isOutline(crop) {
    return crop?.mode === 'outline' && valid(crop.outline) && crop.sw > 0 && crop.sh > 0;
  }

  function fromOutline(points) {
    if (!valid(points)) return null;
    const rect = bounds(points);
    if (rect.sw < 2 || rect.sh < 2) return null;
    return { ...rect, mode: 'outline', outline: copy(points), ovalRatio: rect.sw / rect.sh };
  }

  function ellipse(rect, width, height) {
    const safe = rect?.sw > 0 && rect?.sh > 0 ? rect : {
      sx: width * .2, sy: height * .1, sw: width * .6, sh: height * .8
    };
    const points = Array.from({ length: 18 }, (_, i) => {
      const t = -Math.PI / 2 + i / 18 * Math.PI * 2;
      return {
        x: clamp(safe.sx + safe.sw / 2 + Math.cos(t) * safe.sw / 2, 0, width),
        y: clamp(safe.sy + safe.sh / 2 + Math.sin(t) * safe.sh / 2, 0, height)
      };
    });
    // An oval can be panned completely off the photo; start with a usable contour.
    return valid(points) ? points : ellipse(null, width, height);
  }

  function resize(points, factor, width, height) {
    const box = bounds(points), cx = box.sx + box.sw / 2, cy = box.sy + box.sh / 2;
    return points.map(p => ({
      x: clamp(cx + (p.x - cx) * factor, 0, width),
      y: clamp(cy + (p.y - cy) * factor, 0, height)
    }));
  }

  function nearestEdge(points, point) {
    let nearest = { distance: Infinity, index: 0, point };
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const projected = { x: a.x + t * dx, y: a.y + t * dy };
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (distance < nearest.distance) nearest = { distance, index: i, point: projected };
    });
    return nearest;
  }

  function path(crop, x, y, width, height) {
    const cut = new Path2D();
    if (isOutline(crop)) {
      crop.outline.forEach((p, i) => {
        const px = x + (p.x - crop.sx) / crop.sw * width;
        const py = y + (p.y - crop.sy) / crop.sh * height;
        if (i === 0) cut.moveTo(px, py); else cut.lineTo(px, py);
      });
      cut.closePath();
    } else cut.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    return cut;
  }

  function draw(context, image, crop, x, y, width, height) {
    context.save();
    context.clip(path(crop, x, y, width, height));
    if (crop?.sw > 0 && crop?.sh > 0) context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, x, y, width, height);
    else context.drawImage(image, x, y, width, height);
    context.restore();
  }

  let detectorPromise;
  async function detect(image) {
    if (!detectorPromise) {
      detectorPromise = import('./vendor/mediapipe/vision_bundle.mjs').then(async ({ ImageSegmenter, FilesetResolver }) => {
        const files = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
        return ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: './models/selfie_multiclass_256x256.tflite', delegate: 'CPU' },
          runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false
        });
      }).catch(error => { detectorPromise = null; throw error; });
    }
    const detector = await detectorPromise;
    const input = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    input.width = Math.max(1, Math.round(image.naturalWidth * scale));
    input.height = Math.max(1, Math.round(image.naturalHeight * scale));
    input.getContext('2d').drawImage(image, 0, 0, input.width, input.height);
    let outlines = [];
    // The callback owns its masks; finish tracing before it returns so no GPU/WASM
    // buffers accumulate when the user tries detection on several portraits.
    detector.segment(input, result => {
      const mask = result.categoryMask;
      if (mask) outlines = HeadOutline.extract(mask.getAsUint8Array(), mask.width, mask.height, image.naturalWidth, image.naturalHeight);
    });
    return outlines.filter(valid).sort((a, b) => area(b) - area(a));
  }

  return { bounds, area, valid, isOutline, fromOutline, ellipse, resize, nearestEdge, path, draw, detect, copy, clamp };
})();

if (typeof module !== 'undefined') module.exports = FaceCrop;
