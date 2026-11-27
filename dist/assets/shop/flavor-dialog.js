import { responsiveImage } from '../responsive-images.js';
import { mountFlavorTexture } from './flavor-texture.js';
import { flavorMetaHtml } from './flavor-details.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const enterEase = 'cubic-bezier(.22,.85,.3,1)';
const exitEase = 'cubic-bezier(.45,0,.55,1)';

export function flavorPortrait(flavor, productImage, sizes) {
  if (flavor.image) {
    return `<span class="product-photo flavor-portrait"><img class="flavor-single-photo" src="${escape(flavor.image)}" ${responsiveImage(flavor.image, sizes)} alt="" loading="lazy"></span>`;
  }
  if (flavor.imagePosition != null && productImage) {
    const left = (parseFloat(flavor.imagePosition) || 0) * -2;
    return `<span class="product-photo flavor-portrait" style="--image-left:${left}%"><img src="${escape(productImage)}" alt="" width="2172" height="724" loading="lazy"></span>`;
  }
  return '<span class="product-photo flavor-portrait flavor-photo-fallback" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="m10 29 17-12q5-3 10-1l17 7-16 14zM10 29l1 15 27 7 16-12V23M38 37v14"/><path d="m12 40 26 7 14-10M22 24l5-3m11 3 4 1"/></svg></span>';
}

function visibleBounds(element) {
  const box = element?.getBoundingClientRect();
  return box && box.width && box.height && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight ? box : null;
}

// The image travels in the native dialog's top layer, outside its scrolling panel.
export function createFlavorDialog(dialog, content, { productImage, status, footer = '' }) {
  let active = null;
  function reset() {
    if (!active) return;
    const state = active;
    active = null;
    state.texture?.dispose();
    state.animations.forEach(animation => animation.cancel());
    state.ghost?.remove();
    state.source?.classList.remove('flavor-photo-away');
    state.figure.classList.remove('flavor-photo-away');
    dialog.classList.remove('flavor-detail-dialog', 'flavor-detail-leaving');
  }
  function animate(state, element, frames, options) {
    const animation = element.animate(frames, options);
    state.animations.add(animation);
    animation.finished.then(() => state.animations.delete(animation), () => state.animations.delete(animation));
    return animation;
  }
  function flight(state, start, end, startRadius, endRadius, opening, textureFrame = null) {
    const ghost = state.figure.cloneNode(false);
    const cover = state.figure.querySelector('img,svg');
    if (cover) ghost.append(cover.cloneNode(true));
    if (textureFrame) ghost.append(textureFrame);
    const fromImage = state.source?.querySelector('img');
    const image = ghost.querySelector('img');
    if (image) {
      image.loading = 'eager';
      if (opening && fromImage?.complete && fromImage.currentSrc) {
        image.removeAttribute('srcset');
        image.src = fromImage.currentSrc;
      }
    }
    ghost.classList.remove('flavor-photo-away');
    ghost.classList.add('flavor-flying-photo');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { left: end.left + 'px', top: end.top + 'px', width: end.width + 'px', height: end.height + 'px' });
    dialog.append(ghost);
    state.ghost = ghost;
    state.figure.classList.add('flavor-photo-away');
    state.source?.classList.add('flavor-photo-away');
    const dx = start.left + start.width / 2 - end.left - end.width / 2;
    const dy = start.top + start.height / 2 - end.top - end.height / 2;
    const sx = start.width / end.width, sy = start.height / end.height;
    const lift = Math.min(32, Math.hypot(dx, dy) * .075);
    const turn = Math.sign(dx) * (opening ? 1.5 : -1);
    if (textureFrame) animate(state, textureFrame, [{opacity:1},{opacity:0}], {duration:260,easing:'ease-in-out',fill:'forwards'});
    const animation = animate(state, ghost, [
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, borderRadius: startRadius },
      { transform: `translate(${dx * .44}px,${dy * .44 - lift}px) rotate(${turn}deg) scale(${1 + (sx - 1) * .44},${1 + (sy - 1) * .44})`, offset: .52 },
      { transform: 'none', borderRadius: endRadius }
    ], { duration: opening ? 600 : 440, easing: opening ? enterEase : 'cubic-bezier(.4,0,.24,1)', fill: 'both' });
    animation.finished.then(() => {
      ghost.remove();
      if (state.ghost === ghost) state.ghost = null;
      if (opening) state.figure.classList.remove('flavor-photo-away');
    }, () => {});
    return animation;
  }
  function open(flavor, source = null) {
    if (active?.id === flavor.id && !active.closing) return;
    reset();
    const start = visibleBounds(source);
    const label = status?.(flavor);
    content.innerHTML = `<div class="flavor-detail-surface"><div class="flavor-detail-layout">${flavorPortrait(flavor, productImage, '(max-width: 620px) 240px, 288px')}<div class="flavor-detail-copy"><h2 id="dialog-title" tabindex="-1">${escape(flavor.name)}</h2>${label ? `<p class="flavor-detail-status">${escape(label)}</p>` : ''}${flavor.line ? `<p class="detail-line">${escape(flavor.line)}</p>` : ''}${flavor.description ? `<p class="detail-description">${escape(flavor.description)}</p>` : ''}${flavorMetaHtml(flavor, escape)}${footer}</div></div></div>`;
    const figure = content.querySelector('.flavor-portrait');
    const state = { id: flavor.id, source, figure, ghost: null, animations: new Set(), closing: false };
    active = state;
    dialog.classList.add('flavor-detail-dialog');
    const image = figure.querySelector('img');
    if (image) image.loading = 'eager';
    if (!dialog.open) dialog.showModal();
    content.querySelector('#dialog-title').focus({ preventScroll: true });
    if (reduced.matches || typeof figure.animate !== 'function') {
      state.texture = mountFlavorTexture(figure,flavor.texture_video_path,Promise.resolve(),reduced);
      return;
    }
    let arrival;
    const end = visibleBounds(figure);
    if (start && end && (source.querySelector('img') || source.classList.contains('flavor-photo-fallback'))) {
      arrival = flight(state, start, end, getComputedStyle(source).borderRadius, getComputedStyle(figure).borderRadius, true);
    }
    const surface = animate(state, content.firstElementChild, [{ opacity: 0, transform: 'translateY(8px) scale(.975)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: enterEase });
    animate(state, content.querySelector('.flavor-detail-copy'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 100, easing: enterEase, fill: 'backwards' });
    state.texture = mountFlavorTexture(figure,flavor.texture_video_path,(arrival || surface).finished,reduced);
  }
  function close(restoreFocus) {
    if (active?.closing) return;
    const state = active;
    const finish = () => {
      if (active !== state) return;
      if (dialog.open) dialog.close();
      reset();
      restoreFocus?.();
    };
    if (!state || reduced.matches || typeof dialog.animate !== 'function') { finish(); return; }
    state.closing = true;
    const textureFrame = state.texture?.snapshot();
    state.texture?.dispose();
    const startPhoto = state.ghost || state.figure;
    const start = visibleBounds(startPhoto), end = visibleBounds(state.source);
    const startRadius = getComputedStyle(startPhoto).borderRadius;
    const surface = content.firstElementChild;
    const opacity = getComputedStyle(surface).opacity;
    state.animations.forEach(animation => animation.cancel());
    state.ghost?.remove();
    state.ghost = null;
    dialog.classList.add('flavor-detail-leaving');
    const fade = animate(state, surface, [{ opacity }, { opacity: 0, transform: 'translateY(5px) scale(.98)' }], { duration: 190, easing: exitEase, fill: 'forwards' });
    const returning = start && end && state.source.classList.contains('flavor-photo-away')
      ? flight(state, start, end, startRadius, getComputedStyle(state.source).borderRadius, false, textureFrame) : fade;
    returning.finished.then(finish, () => {});
  }
  reduced.addEventListener?.('change', () => { if (reduced.matches) active?.animations.forEach(animation => animation.finish()); });
  return { open, close, reset };
}
