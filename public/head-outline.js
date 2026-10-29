/* Convert a semantic hair/skin mask into editable, full-head silhouettes. */
const HeadOutline = (() => {
  const polygonArea = points => Math.abs(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / 2;

  function closeGaps(mask, width, height) {
    const dilated = new Uint8Array(mask.length), closed = new Uint8Array(mask.length);
    // Close one-pixel cracks between hair and skin without expanding the whole head.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && mask[(y + dy) * width + x + dx]) dilated[y * width + x] = 1;
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let filled = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        // A head touching the edge of a photo must not be shaved away by erosion.
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && !dilated[(y + dy) * width + x + dx]) filled = 0;
      }
      closed[y * width + x] = filled;
    }
    return closed;
  }

  function components(mask, categories, width, height) {
    const visited = new Uint8Array(mask.length), regions = [];
    for (let seed = 0; seed < mask.length; seed++) {
      if (!mask[seed] || visited[seed]) continue;
      const pixels = [seed];
      visited[seed] = 1;
      let facePixels = 0;
      for (let cursor = 0; cursor < pixels.length; cursor++) {
        const pixel = pixels[cursor], x = pixel % width, y = Math.floor(pixel / width);
        if (categories[pixel] === 3) facePixels++;
        const neighbors = [];
        if (x > 0) neighbors.push(pixel - 1);
        if (x < width - 1) neighbors.push(pixel + 1);
        if (y > 0) neighbors.push(pixel - width);
        if (y < height - 1) neighbors.push(pixel + width);
        for (const next of neighbors) if (mask[next] && !visited[next]) { visited[next] = 1; pixels.push(next); }
      }
      // Ignore tiny scraps of hair/background; retain separate people as separate choices.
      if (facePixels >= Math.max(6, width * height * .0003)) regions.push(pixels);
    }
    return regions.sort((a, b) => b.length - a.length).slice(0, 5);
  }

  function boundary(mask, width, height) {
    const edges = new Map(), stride = width + 1;
    const edge = (x1, y1, x2, y2, direction) => {
      const key = y1 * stride + x1;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ end: y2 * stride + x2, direction });
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (y === 0 || !mask[(y - 1) * width + x]) edge(x, y, x + 1, y, 0);
      if (x === width - 1 || !mask[y * width + x + 1]) edge(x + 1, y, x + 1, y + 1, 1);
      if (y === height - 1 || !mask[(y + 1) * width + x]) edge(x + 1, y + 1, x, y + 1, 2);
      if (x === 0 || !mask[y * width + x - 1]) edge(x, y + 1, x, y, 3);
    }
    let outline = [], largest = 0;
    while (edges.size) {
      const start = edges.keys().next().value;
      let current = start, previousDirection = 0;
      const loop = [];
      do {
        const options = edges.get(current);
        if (!options?.length) break;
        // At diagonal contacts follow the outside of this component, not a crossing.
        const preference = [1, 0, 3, 2];
        options.sort((a, b) => preference.indexOf((a.direction - previousDirection + 4) % 4) - preference.indexOf((b.direction - previousDirection + 4) % 4));
        const next = options.shift();
        if (!options.length) edges.delete(current);
        loop.push({ x: current % stride, y: Math.floor(current / stride) });
        current = next.end; previousDirection = next.direction;
      } while (current !== start);
      const area = polygonArea(loop);
      if (current === start && area > largest) { largest = area; outline = loop; }
    }
    return outline;
  }

  function simplifyLine(points, tolerance) {
    if (points.length < 3) return points;
    const first = points[0], last = points[points.length - 1];
    const dx = last.x - first.x, dy = last.y - first.y, lengthSquared = dx * dx + dy * dy;
    let distance = tolerance * tolerance, split = -1;
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i];
      const t = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (lengthSquared || 1)));
      const squared = (point.x - first.x - t * dx) ** 2 + (point.y - first.y - t * dy) ** 2;
      if (squared > distance) { distance = squared; split = i; }
    }
    if (split < 0) return [first, last];
    return [...simplifyLine(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(split), tolerance)];
  }

  function simplifyRing(points) {
    if (points.length < 4) return points;
    let opposite = 1, farthest = 0;
    points.forEach((p, i) => {
      const distance = (p.x - points[0].x) ** 2 + (p.y - points[0].y) ** 2;
      if (distance > farthest) { farthest = distance; opposite = i; }
    });
    let result, tolerance = .8;
    do {
      result = [
        ...simplifyLine(points.slice(0, opposite + 1), tolerance).slice(0, -1),
        ...simplifyLine([...points.slice(opposite), points[0]], tolerance).slice(0, -1)
      ];
      tolerance *= 1.3;
    } while (result.length > 40);
    return result;
  }

  function extract(data, maskWidth, maskHeight, imageWidth, imageHeight) {
    if (data.length !== maskWidth * maskHeight || maskWidth < 1 || maskHeight < 1) return [];
    const scale = Math.min(1, 384 / Math.max(maskWidth, maskHeight));
    const width = Math.max(1, Math.round(maskWidth * scale)), height = Math.max(1, Math.round(maskHeight * scale));
    const categories = new Uint8Array(width * height), mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = Math.min(maskWidth - 1, Math.floor((x + .5) * maskWidth / width));
      const sourceY = Math.min(maskHeight - 1, Math.floor((y + .5) * maskHeight / height));
      const category = data[sourceY * maskWidth + sourceX];
      categories[y * width + x] = category;
      // Selfie Multiclass: hair=1, face/ears/scalp=3. Neck, body and clothes stay out.
      mask[y * width + x] = category === 1 || category === 3 ? 1 : 0;
    }
    const headRegions = components(closeGaps(mask, width, height), categories, width, height);
    // Eyeglasses and earrings are labelled accessories. Keep accessories adjoining
    // a head, but do not pull in necklaces or other objects below its chin.
    for (const pixels of headRegions) {
      let left = width, right = 0, top = height, bottom = 0;
      for (const pixel of pixels) {
        const x = pixel % width, y = Math.floor(pixel / width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      const pad = Math.max(2, (right - left) * .15);
      for (let y = Math.max(0, Math.floor(top - (bottom - top) * .2)); y <= bottom; y++) {
        for (let x = Math.max(0, Math.floor(left - pad)); x <= Math.min(width - 1, right + pad); x++) {
          if (categories[y * width + x] === 5) mask[y * width + x] = 1;
        }
      }
    }
    return components(closeGaps(mask, width, height), categories, width, height).map(pixels => {
      const component = new Uint8Array(mask.length);
      for (const pixel of pixels) component[pixel] = 1;
      return simplifyRing(boundary(component, width, height)).map(p => ({ x: p.x * imageWidth / width, y: p.y * imageHeight / height }));
    }).filter(points => points.length >= 3);
  }

  return { extract };
})();

if (typeof module !== 'undefined') module.exports = HeadOutline;
