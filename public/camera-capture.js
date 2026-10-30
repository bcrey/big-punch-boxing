/* Live camera viewfinder laid over the crop area. Resolves with a JPEG data URL, or null if cancelled. */
const CameraCapture = (() => {
  const supported = () => !!(typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia && window.isSecureContext);

  function errorMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Camera access was blocked. Allow the camera in your browser settings, or upload a photo instead.';
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'No camera was found on this device.';
    if (error?.name === 'NotReadableError') return 'The camera is in use by another app.';
    return 'Could not start the camera.';
  }

  function open(container, { onError } = {}) {
    let stream = null, facing = 'user', active = null, closed = false, settle;
    const done = new Promise(resolve => settle = resolve);

    const root = document.createElement('div');
    root.className = 'camera-view';
    root.innerHTML = `
      <video playsinline muted autoplay aria-label="Live camera preview"></video>
      <div class="camera-guide" aria-hidden="true"></div>
      <p class="camera-hint" role="status">Starting camera…</p>
      <div class="camera-bar">
        <button type="button" class="camera-cancel" aria-label="Close camera">✕</button>
        <button type="button" class="camera-shutter" aria-label="Take photo" disabled></button>
        <button type="button" class="camera-flip" aria-label="Switch camera" hidden>⟲</button>
      </div>`;
    const video = root.querySelector('video');
    const hint = root.querySelector('.camera-hint');
    const shutter = root.querySelector('.camera-shutter');
    const flip = root.querySelector('.camera-flip');
    container.appendChild(root);

    function stop() {
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
    }

    function close(result) {
      if (closed) return;
      closed = true;
      stop();
      root.remove();
      settle(result);
    }

    async function start() {
      const request = active = {};
      stop();
      shutter.disabled = true;
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }
        });
        if (closed || request !== active) return next.getTracks().forEach(track => track.stop());
        stream = next;
        video.srcObject = stream;
        root.classList.toggle('mirrored', facing === 'user');
        await video.play().catch(() => {});
        hint.textContent = 'Line your head up in the guide';
        shutter.disabled = false;
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        flip.hidden = cameras.length < 2;
      } catch (error) {
        if (closed || request !== active) return;
        onError?.(errorMessage(error));
        close(null);
      }
    }

    function capture() {
      const width = video.videoWidth, height = video.videoHeight;
      if (!width || !height) return;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      // Save what the viewfinder showed: the selfie camera is previewed mirrored.
      if (facing === 'user') { context.translate(width, 0); context.scale(-1, 1); }
      context.drawImage(video, 0, 0, width, height);
      const flash = document.createElement('div');
      flash.className = 'camera-flash';
      flash.addEventListener('animationend', () => flash.remove());
      container.appendChild(flash);
      close(canvas.toDataURL('image/jpeg', .92));
    }

    shutter.onclick = capture;
    root.querySelector('.camera-cancel').onclick = () => close(null);
    flip.onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
    root.addEventListener('keydown', event => { if (event.key === 'Escape') close(null); });
    start();
    shutter.focus();
    return { done, close: () => close(null) };
  }

  return { supported, open, errorMessage };
})();

if (typeof module !== 'undefined') module.exports = CameraCapture;
