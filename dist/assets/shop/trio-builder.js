import {escapeHtml as esc,money} from '../admin/client.js';
import {flavorPickerLimit} from './basket-interactions.js';
import {dateInManila,selectionPrice} from './shop-rules.js';

export function isCustomTrio(product) {
  return product?.kind === 'custom_box' && product.option_groups?.length === 1 &&
    product.option_groups[0].id === 'flavors' && product.option_groups[0].required_count === 3;
}

function countsOf(slots) {
  const counts = Object.create(null);
  for (const id of slots) if (id) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

function imageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, location.href);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function flavorPiece(flavor) {
  const cutout = imageUrl(flavor.builder_cutout_url), cover = imageUrl(flavor.photos?.[0]);
  return `<span class="ep-piece">${cutout || cover
    ? `<img src="${esc(cutout || cover)}" ${cutout ? '' : 'class="framed"'} alt="" data-piece-photo data-cover="${esc(cover)}">`
    : ''}<span class="ep-fallback" ${cutout || cover ? 'hidden' : ''}>${esc(flavor.label)}</span></span>`;
}

function flavorTile(choice, count, limit, full, loading) {
  const cover = imageUrl(choice.photos?.[0]), cutout = imageUrl(choice.builder_cutout_url);
  const extra = choice.surcharge_cents > 0 ? '+' + money(choice.surcharge_cents).replace(/\.00$/, '') + ' each' : '';
  const unavailable = !limit ? 'Sold out' : count >= limit && !full ? 'Stock limit reached' : '';
  const label = ['Add ' + choice.label, extra || 'included', count ? count + ' selected' : '', unavailable].filter(Boolean).join(', ');
  return `<button type="button" class="ep-tile${count ? ' picked' : ''}${!limit ? ' sold' : ''}" data-trio-add="${esc(choice.id)}" data-count="${count}" aria-label="${esc(label)}" ${loading || full || count >= limit ? 'disabled' : ''}>
    <span class="ep-thumb">${cover || cutout ? `<img src="${esc(cover || cutout)}" class="${cover ? '' : 'cutout'}" alt="" decoding="async">` : ''}<span class="ep-fallback" ${cover || cutout ? 'hidden' : ''}>${esc(choice.label)}</span>${count ? `<span class="ep-badge">×${count}</span>` : ''}</span>
    <span class="ep-tile-footer"><span class="ep-tile-text"><strong>${esc(choice.label)}</strong>${extra ? `<span class="ep-extra">${esc(extra)}</span>` : ''}${unavailable ? `<span class="ep-unavailable">${unavailable}</span>` : ''}</span><span class="ep-plus" aria-hidden="true">+</span></span>
  </button>`;
}

export function trioBreakdown(line,product) {
  if(!isCustomTrio(product))return '';
  const quoted=line.selection_labels;
  const parts=Array.isArray(quoted)&&quoted.length&&quoted.every(row=>row&&typeof row==='object')
    ? quoted : product.option_groups[0].choices.map(choice=>({label:choice.label,quantity:line.selections?.flavors?.[choice.id]||0,surcharge_cents:choice.surcharge_cents})).filter(row=>row.quantity>0);
  if(!parts.length)return '';
  const extras=parts.reduce((sum,row)=>sum+Number(row.quantity)*Number(row.surcharge_cents||0),0);
  const unit=Number(line.unit_price_cents);
  const row=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  return `<dl class="trio-breakdown">${row('Trio base price',money(unit-extras))}${parts.map(part=>{
    const extra=Number(part.surcharge_cents||0);
    return row(`${part.quantity} × ${part.label}${extra?' (+'+money(extra)+' each)':''}`,extra?'+'+money(extra*part.quantity):'Included');
  }).join('')}${row('Box subtotal',money(unit))}${line.quantity>1?row(`${line.quantity} boxes`,money(line.line_total_cents??unit*line.quantity)):''}</dl>`;
}

export function mountTrioBuilder(dialog, {read, draft, save, commit, close, chooseDate, retry, verify, details}) {
  const group = () => read().product.option_groups[0];
  const initial = draft?.slots || Object.entries(draft?.selected?.flavors || {}).flatMap(([id,count]) => Array(count).fill(id));
  const slots = Array.from({length:3}, (_,i) => initial[i] || null);
  let quantity = draft?.quantity || 1, loading = false, failed = false, committing = false, showAll = false, disposed=false;
  const names = new Map(), flights = new Map();
  const closed = new AbortController();
  const selected = () => ({flavors: countsOf(slots)});
  const currency = number => money(number).replace(/\.00$/, '');
  dialog.classList.add('trio-dialog');
  dialog.innerHTML = `<div class="trio-surface"><header class="ep-header"><button type="button" data-trio-close aria-label="Close product">‹ Boxes</button><span class="ep-logo" aria-hidden="true">ELIO</span><button type="button" data-trio-date aria-haspopup="dialog" aria-controls="customer-calendar-popup"></button></header>
  <div class="ep-main"><h2 id="product-title"></h2><p class="ep-lead"></p><div id="product-error" role="status" aria-live="polite" hidden></div>
  <div class="ep-layout"><section aria-label="Your box"><div class="ep-box-head"><h3>Your box</h3><span class="ep-count" data-group-count="flavors"></span></div>
  <div class="ep-scene"><div class="ep-world"><img class="ep-package" src="assets/shop/trio/open-box.webp" alt="Open ELIO box with three spaces"><div data-trio-slots></div><img class="ep-rim" src="assets/shop/trio/open-box.webp" alt=""></div></div><div class="ep-slot-names" aria-hidden="true"></div></section>
  <div><div class="ep-grid" role="group" aria-label="Choose your flavors"></div><button type="button" data-trio-more class="ep-more" hidden></button></div></div>
  <div class="ep-order-tools"><label class="field" for="product-quantity">Boxes<input type="number" min="1" max="999" step="1" id="product-quantity" value="${quantity}"></label>
  <details class="ep-details"><summary>Box photos &amp; details</summary><div>${details}</div></details></div>
  </div><footer class="ep-bar"><div class="ep-total"><span data-trio-total-label></span><strong id="detail-price"></strong><small data-trio-extra></small></div><div class="ep-actions"><button type="button" id="trio-checkout" class="ep-primary"></button><button type="button" id="add-to-cart" class="ep-continue" hidden>Add and continue shopping</button></div></footer>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-trio-live></div></div>`;
  const $ = selector => dialog.querySelector(selector);
  const surface = $('.trio-surface'), grid = $('.ep-grid'), tray = $('[data-trio-slots]');
  const qtyInput = $('#product-quantity'),error = $('#product-error');
  const limit = (choice, ctx) => flavorPickerLimit(ctx.items,ctx.products,choice,quantity,ctx.inventory,ctx.date).maximum;
  const notice = message => { error.textContent=message || ''; error.hidden=!message; };
  const announce = message => { $('[data-trio-live]').textContent=message; };
  function imageFailed(event) {
    const img=event.target;
    if(img.tagName!=='IMG' || (!img.closest('.ep-piece') && !img.closest('.ep-thumb')))return;
    if(img.dataset.cover && img.src!==img.dataset.cover){img.className='framed';img.src=img.dataset.cover;return;}
    img.hidden=true;
    const fallback=img.parentElement.querySelector('.ep-fallback');
    if(fallback)fallback.hidden=false;
  }
  surface.addEventListener('error',imageFailed,true);
  function position(index) {return tray.querySelector(`[data-position="${index}"] .ep-piece`);}
  function fly(index, from) {
    const target=position(index);
    if(!target?.animate || !from?.width || matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const end=target.getBoundingClientRect(), box=surface.getBoundingClientRect();
    if(!end.width)return;
    const ghost=document.createElement('span');
    ghost.className='ep-ghost';ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{left:(end.left-box.left)+'px',top:(end.top-box.top)+'px',width:end.width+'px',height:end.height+'px'});
    const moving=target.cloneNode(true);moving.style.visibility='';
    ghost.append(moving);surface.append(ghost);
    const dx=from.left+from.width/2-end.left-end.width/2, dy=from.top+from.height/2-end.top-end.height/2;
    const scale=Math.min(1.7,Math.max(.7,from.width/end.width));
    const animation=ghost.animate([{transform:`translate(${dx}px,${dy}px) scale(${scale})`},{transform:`translate(${dx*.51}px,${dy*.51-13}px) scale(1.03)`,offset:.52},{transform:'translate(0,0) scale(1)'}],{duration:310,easing:'cubic-bezier(.25,.65,.30,1)',fill:'both'});
    const flight={id:slots[index],animation};
    flights.set(index,flight);target.style.visibility='hidden';
    animation.onfinish=animation.oncancel=()=>{
      ghost.remove();
      if(flights.get(index)!==flight)return;
      flights.delete(index);
      const landed=position(index);if(landed)landed.style.visibility='';
    };
  }
  function draw(focus, reconcile=false) {
    const ctx=read(), product=ctx.product;
    const choices=product.option_groups[0].choices;
    const month=(ctx.date||dateInManila()).slice(0,7)+'-01';
    const offered=choices.filter(c=>c.active!==false&&(!Array.isArray(c.available_months)||c.available_months.includes(month)));
    const byId=new Map(offered.map(c=>[c.id,c]));
    for(const c of choices)names.set(c.id,c.label);
    if(reconcile && !loading && !failed){
      const kept=Object.create(null),removed=[];
      slots.forEach((id,index)=>{
        if(!id)return;
        const c=byId.get(id);
        if(c&&(kept[id]||0)<limit(c,ctx)){kept[id]=(kept[id]||0)+1;return;}
        removed.push(names.get(id)||'a flavor');slots[index]=null;
      });
      if(removed.length)notice('Please replace '+removed.join(', ')+'. The available stock or lineup has changed.');
    }
    const counts=countsOf(slots), count=slots.filter(Boolean).length;
    const unit=selectionPrice(product,{flavors:counts},{allowIncomplete:true});
    const complete=count===3, validQty=Number.isInteger(Number(qtyInput.value))&&Number(qtyInput.value)>=1&&Number(qtyInput.value)<=999;
    const available=ctx.availability.available && Boolean(ctx.date) && !ctx.paused && !loading && !failed && validQty;
    const canAdd=complete&&available&&!committing;
    $('#product-title').textContent=product.name;
    $('.ep-lead').textContent=complete?'Your trio is ready. Tap a cake in the box to remove it.':'Choose three from this month’s lineup. You can repeat a favorite.';
    $('[data-trio-date]').textContent=ctx.date?new Intl.DateTimeFormat('en-PH',{weekday:'short',month:'short',day:'numeric',timeZone:'Asia/Manila'}).format(new Date(ctx.date+'T12:00:00+08:00')):'Choose your date';
    $('.ep-count').textContent=count+' of 3';
    tray.innerHTML=slots.map((id,i)=>{
      const c=byId.get(id)||choices.find(x=>x.id===id);
      return c?`<button type="button" class="ep-slot occupied" data-position="${i}" data-trio-remove="${i}" data-trio-flavor="${esc(id)}" aria-label="Remove ${esc(c.label)} from position ${i+1}">${flavorPiece(c)}<span class="ep-remove" aria-hidden="true">×</span></button>`:`<span class="ep-slot" data-position="${i}"><span class="ep-slot-number">${i+1}</span></span>`;
    }).join('');
    $('.ep-slot-names').innerHTML=slots.map(id=>`<span>${id?esc(names.get(id)||''):''}</span>`).join('');
    const visible=showAll?offered:offered.slice(0,9);
    grid.innerHTML=visible.length?visible.map(c=>flavorTile(c,counts[c.id]||0,limit(c,ctx),complete,loading||failed)).join(''):'<p class="ep-empty">No flavors are listed for this date. Choose another date.</p>';
    const more=$('[data-trio-more]');more.hidden=offered.length<=9;more.textContent=showAll?'Show fewer flavors':`See all ${offered.length} flavors`;more.setAttribute('aria-expanded',String(showAll));
    $('[data-trio-total-label]').textContent=quantity>1?`Subtotal for ${quantity} boxes`:count?'Box subtotal':'Trio base price';
    $('#detail-price').textContent=currency(unit*quantity);
    const extras=unit-Number(product.price_cents);
    $('[data-trio-extra]').textContent=extras>0?`${currency(product.price_cents)} base + ${currency(extras)} extras${quantity>1?' per box':''}`:'';
    const action=$('#trio-checkout');
    action.textContent=loading?'Checking stock…':failed?'Retry stock check':!ctx.date?'Choose your date':!ctx.availability.available?'Unavailable this date':ctx.paused?'Ordering paused':complete?'Checkout':`Choose ${3-count} more ${count===2?'flavor':'flavors'}`;
    action.disabled=(!failed&&Boolean(ctx.date)&&!canAdd)||loading||committing;
    $('#add-to-cart').hidden=!canAdd;$('#add-to-cart').disabled=!canAdd;
    for(const [n,f] of flights){const dest=position(n);if(dest&&slots[n]===f.id)dest.style.visibility='hidden';else{flights.delete(n);f.animation.cancel();}}
    if(focus){const el=$(focus);(el&&!el.disabled?el:canAdd?action:$('.ep-tile:enabled')||$('.ep-slot.occupied')||$('[data-trio-date]')).focus({preventScroll:true});}
    if(!loading&&!failed)save(selected(),quantity,slots);
    return {count,total:unit*quantity,canAdd};
  }
  async function finish(checkout) {
    if(committing)return;
    const before=draw(null,true);if(!before.canAdd)return;
    const original=JSON.stringify([slots,quantity,read().date]);
    committing=true;$('#trio-checkout').disabled=true;$('#add-to-cart').disabled=true;
    try {
      if(!await verify()||disposed||!dialog.open)return;
      committing=false;
      const fresh=draw(null,true);
      if(!fresh.canAdd||original!==JSON.stringify([slots,quantity,read().date]))return;
      if(before.total!==fresh.total){notice('The flavor or box price changed. Review the updated subtotal and confirm again.');return;}
      committing=true;
      commit(selected(),quantity,checkout);
    }catch(e){notice(e.message);}
    finally{committing=false;if(!disposed&&dialog.open)draw();}
  }
  surface.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    const ctx=read(),keyboard=event.detail===0;
    if(button.hasAttribute('data-trio-close')){close();return;}
    if(button.hasAttribute('data-trio-date')){chooseDate(button);return;}
    if(button.id==='trio-checkout'){
      if(failed){retry();return;}
      if(!ctx.date){chooseDate(button);return;}
      finish(true);return;
    }
    if(button.id==='add-to-cart'){finish(false);return;}
    if(button.hasAttribute('data-trio-more')){showAll=!showAll;draw(keyboard?'[data-trio-more]':null);return;}
    if(button.dataset.trioAdd){
      const id=button.dataset.trioAdd,index=slots.indexOf(null),choice=group().choices.find(c=>c.id===id);
      if(index===-1||!choice||loading||failed||(countsOf(slots)[id]||0)>=limit(choice,ctx))return;
      const from=button.querySelector('.ep-thumb').getBoundingClientRect();notice('');slots[index]=id;
      const result=draw(keyboard?`[data-trio-add="${CSS.escape(id)}"]`:null);fly(index,from);
      announce(`${choice.label} added. ${result.count} of 3. Subtotal ${currency(result.total)}.`);
    }else if(button.hasAttribute('data-trio-remove')){
      const n=Number(button.dataset.trioRemove),id=slots[n];slots[n]=null;notice('');
      const result=draw(keyboard?`[data-trio-add="${CSS.escape(id)}"]`:null);
      announce(`${names.get(id)} removed. ${result.count} of 3. Subtotal ${currency(result.total)}.`);
    }
  });
  qtyInput.addEventListener('input',()=>{
    const n=Number(qtyInput.value);
    if(Number.isInteger(n)&&n>0&&n<=999)quantity=n;
    draw(null,true);
  });
  function destroy(){if(disposed)return;disposed=true;closed.abort();for(const f of flights.values())f.animation.cancel();surface.removeEventListener('error',imageFailed,true);dialog.classList.remove('trio-dialog');}
  dialog.addEventListener('close',()=>{if(!dialog.open)destroy();},{signal:closed.signal});
  if(draft?.adjusted)notice('Some saved choices are no longer available. Please complete your box with the current selection.');
  draw(null,true);
  return {productId:read().product.id,destroy,update(status='ready'){
    if(disposed||!dialog.open)return;
    loading=status==='loading';failed=status==='failed';
    if(failed)notice('Couldn’t check stock for this date. Retry to keep building.');
    else if(status==='ready')notice('');
    draw(null,status==='ready');
  }};
}
