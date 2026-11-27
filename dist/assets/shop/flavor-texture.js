import { flavorVideoUrl } from '../flavor-video.js';

const playIcon = '<path d="m8 5 11 7-11 7z"/>';
const pauseIcon = '<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>';

export function mountFlavorTexture(figure, path, entered, motion) {
  const url = flavorVideoUrl(path);
  if (!url) return null;
  const video = document.createElement('video');
  video.className = 'flavor-texture';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = motion.matches ? 'none' : 'auto';
  video.setAttribute('aria-hidden','true');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'flavor-video-toggle';
  toggle.hidden = true;
  const events = new AbortController();
  const {signal} = events;
  let presented = false, frameCallback = null;

  function label() {
    const paused = video.paused;
    toggle.setAttribute('aria-label', paused ? 'Play texture video' : 'Pause texture video');
    toggle.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">${paused ? playIcon : pauseIcon}</svg>`;
  }
  function showFrame() {
    if (!signal.aborted && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      presented = true;
      video.classList.add('is-playing');
    }
  }
  function play() {
    video.play().catch(() => { if (!signal.aborted) label(); });
  }
  function dispose() {
    if (signal.aborted) return;
    events.abort();
    if (frameCallback != null) video.cancelVideoFrameCallback?.(frameCallback);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    toggle.remove();
  }
  function snapshot() {
    if (!presented || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640,video.videoWidth);
    canvas.height = Math.max(1,Math.round(canvas.width * video.videoHeight / video.videoWidth));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // A phone can discard the decoded frame when playback is interrupted.
    try { ctx.drawImage(video,0,0,canvas.width,canvas.height); }
    catch { return null; }
    canvas.className = 'flavor-texture is-playing';
    return canvas;
  }
  video.addEventListener('playing', () => {
    label();
    if (presented) return;
    // Keep the cover visible until a decoded frame is available to the compositor.
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameCallback = video.requestVideoFrameCallback(showFrame);
    } else requestAnimationFrame(showFrame);
  }, {signal});
  video.addEventListener('pause',label,{signal});
  video.addEventListener('error',dispose,{signal});
  toggle.addEventListener('click',() => { if (video.paused) play(); else video.pause(); },{signal});
  motion.addEventListener('change',() => { if (motion.matches) video.pause(); },{signal});
  figure.removeAttribute('aria-hidden');
  figure.append(video,toggle);
  label();
  video.src = url;
  entered.then(() => {
    if (signal.aborted) return;
    toggle.hidden = false;
    if (!motion.matches) play();
  },()=>{});
  return {dispose,snapshot};
}
