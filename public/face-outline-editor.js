class FaceOutlineEditor {
  constructor(area, image, crop, onChange) {
    this.area = area;
    this.image = image;
    this.onChange = onChange;
    this.points = FaceCrop.isOutline(crop) ? FaceCrop.copy(crop.outline) : FaceCrop.ellipse(crop, image.naturalWidth, image.naturalHeight);
    this.original = FaceCrop.copy(this.points);
    this.history = [];
    this.selected = -1;
    this.request = 0;
    this.attempted = FaceCrop.isOutline(crop);
    this.faces = [];
    this.faceIndex = 0;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.message = this.attempted ? 'Saved outline loaded. Find head outline to retrace the hair, or drag points to fine tune.' : 'Find the whole head, including hair, or shape the outline yourself.';
  }

  mount() {
    this.active = true;
    this.area.replaceChildren();
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.className = 'outline-canvas';
    this.handles = document.createElement('div');
    this.handles.className = 'outline-handles';
    this.area.append(this.canvas, this.handles);
    this.area.onpointerdown = event => this.pointerDown(event);
    this.area.onpointermove = event => this.pointerMove(event);
    this.area.onpointerup = this.area.onpointercancel = event => this.pointerUp(event);
    this.area.ondblclick = event => this.addPoint(event);
    this.area.onkeydown = event => this.keyDown(event);
    this.fit();
    if (!this.attempted) this.detect();
  }

  unmount() {
    this.active = false;
    this.request++;
    this.busy = false;
    this.drag = null;
    this.area.onpointerdown = this.area.onpointermove = this.area.onpointerup = this.area.onpointercancel = null;
    this.area.ondblclick = this.area.onkeydown = null;
  }

  remember() {
    this.history.push(FaceCrop.copy(this.points));
    if (this.history.length > 40) this.history.shift();
  }

  cancelDetection() {
    // A late detector result must never overwrite manual tuning.
    if (this.busy) { this.request++; this.busy = false; this.message = 'Manual outline. Drag points to fine tune, or find the head again.'; }
  }

  update() {
    if (!this.active) return;
    this.draw();
    this.onChange();
    document.getElementById('outlineStatus').textContent = this.message;
    document.getElementById('detectOutline').disabled = !!this.busy;
    document.getElementById('saveFighterButton').disabled = !!this.busy || this.area.dataset.loading === 'true';
    document.getElementById('detectOutline').textContent = this.busy ? 'Finding head…' : 'Find head outline';
    document.getElementById('undoOutline').disabled = !this.history.length;
    document.getElementById('removeOutlinePoint').disabled = this.selected < 0 || this.points.length <= 3;
    const next = document.getElementById('nextOutlineFace');
    next.classList.toggle('hidden', this.faces.length < 2);
    next.textContent = `Head ${this.faceIndex + 1}/${this.faces.length} ›`;
  }

  fit() {
    const rect = FaceCrop.bounds(this.points);
    this.zoom = Math.min(this.area.clientWidth / (rect.sw * 1.3), this.area.clientHeight / (rect.sh * 1.3));
    this.pan = {
      x: this.area.clientWidth / 2 - (rect.sx + rect.sw / 2) * this.zoom,
      y: this.area.clientHeight / 2 - (rect.sy + rect.sh / 2) * this.zoom
    };
    this.update();
  }

  viewZoom(factor) {
    const next = this.zoom * factor;
    const fit = Math.min(this.area.clientWidth / this.image.naturalWidth, this.area.clientHeight / this.image.naturalHeight);
    if (next < fit * .3 || next > fit * 16) return;
    this.pan.x = this.area.clientWidth / 2 + (this.pan.x - this.area.clientWidth / 2) * factor;
    this.pan.y = this.area.clientHeight / 2 + (this.pan.y - this.area.clientHeight / 2) * factor;
    this.zoom = next;
    this.update();
  }

  async detect() {
    if (this.busy || !this.active) return;
    const request = ++this.request;
    this.attempted = true;
    this.busy = true;
    this.message = 'Finding the head and hair… First use may take a few seconds.';
    this.update();
    let timeout;
    try {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const faces = await Promise.race([
        FaceCrop.detect(this.image),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Detection timed out')), 30000); })
      ]);
      if (!this.active || request !== this.request) return;
      this.faces = faces;
      this.faceIndex = 0;
      if (faces.length) this.useFace();
      else this.message = 'No head found. Drag the points around the head and hair, or try a clearer photo.';
    } catch (error) {
      if (!this.active || request !== this.request) return;
      this.message = 'Detection unavailable. You can still trace the head and hair by dragging points, or retry.';
      console.warn('Head outline detection unavailable:', error.message);
    } finally {
      clearTimeout(timeout);
      if (this.active && request === this.request) { this.busy = false; this.update(); }
    }
  }

  useFace() {
    this.remember();
    this.points = FaceCrop.copy(this.faces[this.faceIndex]);
    this.original = FaceCrop.copy(this.points);
    this.selected = -1;
    this.message = this.faces.length > 1 ? 'Several heads found. Use the head button to choose, then fine tune.' : 'Head and hair outlined. Drag any point to fine tune the cut.';
    this.fit();
  }

  nextFace() {
    if (!this.faces.length) return;
    this.cancelDetection();
    this.faceIndex = (this.faceIndex + 1) % this.faces.length;
    this.useFace();
  }

  resize(factor) {
    const points = FaceCrop.resize(this.points, factor, this.image.naturalWidth, this.image.naturalHeight);
    if (!FaceCrop.valid(points)) return;
    this.cancelDetection();
    this.remember();
    this.points = points;
    this.update();
  }

  undo() {
    if (!this.history.length) return;
    this.cancelDetection();
    this.points = this.history.pop();
    this.selected = -1;
    this.update();
  }

  reset() {
    this.cancelDetection();
    this.remember();
    this.points = FaceCrop.copy(this.original);
    this.selected = -1;
    this.fit();
  }

  removePoint() {
    if (this.selected < 0 || this.points.length <= 3) return;
    const points = this.points.filter((_, i) => i !== this.selected);
    if (!FaceCrop.valid(points)) return;
    this.cancelDetection();
    this.remember();
    this.points = points;
    this.selected = -1;
    this.update();
  }

  position(event) {
    const rect = this.area.getBoundingClientRect();
    return { x: (event.clientX - rect.left - this.pan.x) / this.zoom, y: (event.clientY - rect.top - this.pan.y) / this.zoom };
  }

  pointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const index = event.target.closest('[data-outline-point]')?.dataset.outlinePoint;
    this.selected = index == null ? -1 : Number(index);
    if (this.selected >= 0) {
      this.cancelDetection();
      event.target.focus();
    }
    this.drag = { x: event.clientX, y: event.clientY, pan: { ...this.pan }, point: this.selected };
    this.area.setPointerCapture(event.pointerId);
    this.update();
  }

  pointerMove(event) {
    if (!this.drag) return;
    if (this.drag.point >= 0) {
      const point = this.position(event), points = FaceCrop.copy(this.points);
      points[this.drag.point] = {
        x: FaceCrop.clamp(point.x, 0, this.image.naturalWidth),
        y: FaceCrop.clamp(point.y, 0, this.image.naturalHeight)
      };
      if (FaceCrop.valid(points)) {
        if (!this.drag.remembered) { this.remember(); this.drag.remembered = true; }
        this.points = points;
      }
    } else {
      this.pan = { x: this.drag.pan.x + event.clientX - this.drag.x, y: this.drag.pan.y + event.clientY - this.drag.y };
    }
    this.update();
  }

  pointerUp(event) {
    this.drag = null;
    if (this.area.hasPointerCapture(event.pointerId)) this.area.releasePointerCapture(event.pointerId);
  }

  addPoint(event) {
    if (event.target.closest('[data-outline-point]') || this.points.length >= 80) return;
    const nearest = FaceCrop.nearestEdge(this.points, this.position(event));
    if (nearest.distance * this.zoom > 14) return;
    if (this.points.some(p => Math.hypot(p.x - nearest.point.x, p.y - nearest.point.y) * this.zoom < 8)) return;
    this.cancelDetection();
    this.remember();
    this.selected = nearest.index + 1;
    this.points.splice(this.selected, 0, nearest.point);
    this.update();
    this.handles.children[this.selected]?.focus();
  }

  keyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.stopPropagation(); this.undo(); return;
    }
    const index = event.target.dataset.outlinePoint;
    if (index == null) return;
    this.selected = Number(index);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); this.removePoint(); return;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const points = FaceCrop.copy(this.points), p = points[this.selected], step = (event.shiftKey ? 5 : 1) / this.zoom;
    p.x = FaceCrop.clamp(p.x + direction[0] * step, 0, this.image.naturalWidth);
    p.y = FaceCrop.clamp(p.y + direction[1] * step, 0, this.image.naturalHeight);
    if (FaceCrop.valid(points)) { this.cancelDetection(); this.remember(); this.points = points; this.update(); }
  }

  draw() {
    const width = this.area.clientWidth, height = this.area.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const context = this.canvas.getContext('2d');
    context.scale(dpr, dpr);
    context.drawImage(this.image, this.pan.x, this.pan.y, this.image.naturalWidth * this.zoom, this.image.naturalHeight * this.zoom);
    const rect = FaceCrop.bounds(this.points);
    const path = FaceCrop.path(FaceCrop.fromOutline(this.points), this.pan.x + rect.sx * this.zoom, this.pan.y + rect.sy * this.zoom, rect.sw * this.zoom, rect.sh * this.zoom);
    const shade = new Path2D(); shade.rect(0, 0, width, height); shade.addPath(path);
    context.fillStyle = '#102235b8'; context.fill(shade, 'evenodd');
    context.strokeStyle = '#ffcc6c'; context.lineWidth = 2; context.stroke(path);
    if (this.handles.childElementCount !== this.points.length) {
      this.handles.replaceChildren(...this.points.map((_, i) => {
        const handle = document.createElement('button');
        handle.type = 'button'; handle.className = 'outline-point';
        handle.dataset.outlinePoint = i;
        handle.setAttribute('aria-label', `Outline point ${i + 1}. Use arrow keys to move, Delete to remove.`);
        handle.onfocus = () => { this.selected = i; this.update(); };
        return handle;
      }));
    }
    this.points.forEach((point, i) => {
      const handle = this.handles.children[i];
      handle.style.left = `${this.pan.x + point.x * this.zoom}px`;
      handle.style.top = `${this.pan.y + point.y * this.zoom}px`;
      handle.classList.toggle('selected', i === this.selected);
      handle.setAttribute('aria-pressed', String(i === this.selected));
    });
  }
}
