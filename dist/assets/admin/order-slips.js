import { escapeHtml as esc, formatDate } from './client.js';
import { flavorName, orderItemDetails, renderOrderFlavors } from './order-item-details.js';

const label = value => String(value || '').replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase());
const text = value => String(value ?? '').trim();
const lines = values => values.map(text).filter(Boolean).join('\n');
const previewUrl = new URL('./order-print.html?v=flavor-details-1', import.meta.url).href;

const paperDimensions = { a4: [297, 210], letter: [279.4, 215.9] };
const maxCopies = 20;

function photoUrl(value) {
  if (typeof value !== 'string' || !(/^(https?:\/\/|assets\/)/.test(value))) return '';
  return new URL(value, document.baseURI).href;
}

// Only fields intended for the package are copied into the print document.
// Item labels come from the saved order; catalog data supplies its current photo.
function printModel(order, products, settings) {
  const pickup = order.method === 'pickup';
  const buyer = order.buyer || {};
  const social = buyer.social_platform === 'na' ? 'Social contact: N/A' :
    buyer.social_username ? `${label(buyer.social_platform) || 'Social contact'}: ${buyer.social_username}` : 'Social contact: Not recorded';
  const details = [];
  details.push({ title: pickup ? 'Pickup details' : 'Deliver to', value: pickup ? lines([
    `Collector: ${buyer.name || 'Not recorded'}`, order.pickup_address ?? settings.pickup_address,
    order.pickup_hours ?? settings.pickup_hours,
  ]) : lines([
    [order.recipient?.name, order.recipient?.phone].filter(Boolean).join(' | '),
    order.address?.line1, order.address?.line2, [order.address?.locality, order.address?.postal_code].filter(Boolean).join(' '),
  ]) || 'Not recorded' });
  details.push({ title: 'Instructions', value: text(order.instructions) || 'None' });
  const status = [order.refund_label ? 'Refunded' : '', ['cancelled', 'expired'].includes(order.fulfillment_status) ? label(order.fulfillment_status) : ''].filter(Boolean).join(' | ');
  return {
    shop: text(settings.shop_name) || 'Elio Basque Cheesecake', reference: text(order.reference) || 'Order',
    date: formatDate(order.fulfillment_date), method: pickup ? 'Pickup' : 'Delivery', status,
    window: text(pickup ? order.pickup_hours ?? settings.pickup_hours : order.delivery_window ?? settings.delivery_window),
    buyer: { name: text(buyer.name) || 'Not recorded', phone: text(buyer.phone) || 'Not recorded', social }, details,
    items: (order.items || []).map((item, index) => {
      const product = products.find(entry => entry.id === item.product_id);
      const { flavors, insulated, extras } = orderItemDetails(item, product);
      const packing = insulated ? 'Insulated · ' + insulated : '';
      const notes = lines([item.description, ...extras]);
      const variation = lines([packing, flavors.map(flavorName).join(' · '), notes]);
      return { index, name: text(item.name) || product?.name || 'Product', quantity: item.quantity,
        variation, notes, packing, flavors: renderOrderFlavors(flavors, { products, esc }), photo: photoUrl(product?.photos?.[0]) };
    }),
  };
}

function element(doc, html) {
  const template = doc.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild;
}

function createSlip(doc, model) {
  return element(doc, `<article class="slip" data-order-reference="${esc(model.reference)}">
    <header class="slip-header"><p class="slip-brand">${esc(model.shop)}</p><h1 class="slip-reference">${esc(model.reference)}</h1>
      <p class="slip-method">${esc(model.method.toUpperCase())}</p><p class="slip-date">${esc(model.date)}${model.window ? ` | ${esc(model.window)}` : ''}</p><p class="slip-state">${esc(model.status)}</p></header>
    <div class="slip-body"><div class="slip-left"><h2 class="slip-heading slip-item-heading">Items to prepare</h2><div class="slip-items"></div></div>
      <div class="slip-right"><section class="slip-buyer"><h2 class="slip-heading">Buyer</h2><p class="slip-buyer-name">${esc(model.buyer.name)}</p><p class="slip-buyer-phone">${esc(model.buyer.phone)}</p><p class="slip-buyer-social">${esc(model.buyer.social)}</p></section><div class="slip-details"></div><p class="slip-signoff">Prepared: ______ &nbsp; Checked: ______</p></div></div>
    <footer class="slip-footer"><span class="slip-number">Slip 000 of 000</span><span>Keep all slips with this order</span></footer></article>`);
}

function itemCard(doc, item, value, continued = false, withFlavors = false) {
  return element(doc, `<section class="slip-item" data-item-index="${item.index}" data-continued="${continued}">
    <div class="slip-photo">${!continued && item.photo ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}" referrerpolicy="no-referrer">` : continued ? 'Cont.' : 'No photo'}</div>
    <div class="slip-item-copy"><h3 class="slip-item-title">${continued ? `<span class="slip-continuation">Item ${item.index + 1} continued</span>` : `<span class="slip-quantity">${esc(item.quantity)}×</span>${esc(item.name)}`}</h3>
    ${withFlavors ? (item.packing ? `<p class="order-packing">${esc(item.packing)}</p>` : '') + item.flavors : ''}
    <p class="slip-variation"${!value && withFlavors ? ' hidden' : ''}>${esc(value)}</p></div></section>`);
}

function detailCard(doc, title, value, continued = false) {
  return element(doc, `<section class="slip-detail"><h2 class="slip-heading">${esc(title)}${continued ? ' (continued)' : ''}</h2><p>${esc(value)}</p></section>`);
}

const fits = column => column.scrollHeight <= column.clientHeight + 1;

const fitsSlip = page => ['.slip-left','.slip-right','.slip-details','.slip-body'].every(selector=>{
  const node=page.querySelector(selector);return fits(node)&&node.scrollWidth<=node.clientWidth+1;
})&&fits(page)&&page.scrollWidth<=page.clientWidth+1;

// Used only when the complete order cannot fit a compact half-sheet. Keep
// every character of the items and instructions, and repeat the order identity.
function overflowSlips(doc,model){
  const pages=[],items=model.items.map(item=>({item,value:item.variation,continued:false}));
  const details=model.details.filter(d=>d.value&&d.value!=='None').map(d=>({...d,continued:false}));
  const partThatFits=(page,node,value,target)=>{
    const chars=Array.from(value);let low=0,high=chars.length;
    while(low<high){const mid=Math.ceil((low+high)/2);target.textContent=chars.slice(0,mid).join('');if(fitsSlip(page))low=mid;else high=mid-1;}
    if(!low){node.remove();throw Error(model.reference+' contains a heading or contact field too large to print legibly. Shorten that field and try again.');}
    // Prefer a word boundary when there is one near the maximum fitting length.
    let cut=low;for(let i=low-1;i>=Math.floor(low*.8);i--)if(/\s/.test(chars[i])){cut=i+1;break;}
    target.textContent=chars.slice(0,cut).join('');return chars.slice(cut).join('');
  };
  while(items.length||details.length){
    const page=createSlip(doc,model);page.className='slip slip-half slip-compact';page.dataset.size='half';
    doc.querySelector('#slips').append(page);pages.push(page);
    const itemHost=page.querySelector('.slip-items');let detailHost=page.querySelector('.slip-details'),progressed=false;
    if(!fitsSlip(page))throw Error(model.reference+' contains a heading or contact field too large to print legibly. Shorten that field and try again.');
    while(items.length){
      const entry=items[0],node=itemCard(doc,entry.item,entry.value,entry.continued);itemHost.append(node);
      if(fitsSlip(page)){items.shift();progressed=true;continue;}
      node.remove();if(itemHost.children.length&&!entry.continued)break;
      itemHost.append(node);
      if(itemHost.children.length>1){node.querySelector('.slip-variation').textContent='';if(!fitsSlip(page)){node.remove();break;}}
      entry.value=partThatFits(page,node,entry.value,node.querySelector('.slip-variation'));entry.continued=true;progressed=true;
      if(!entry.value)items.shift();
    }
    // Once items finish, use the vacant wide column for long instructions.
    // This avoids adding slips whose item area would otherwise remain empty.
    if(!items.length&&!itemHost.children.length&&details.length){
      detailHost=element(doc,'<div class="slip-overflow-details"></div>');page.querySelector('.slip-left').append(detailHost);
    }
    while(details.length){
      const entry=details[0],node=detailCard(doc,entry.title,entry.value,entry.continued);detailHost.append(node);
      if(fitsSlip(page)){details.shift();progressed=true;continue;}
      node.querySelector('p').textContent='';
      if(!fitsSlip(page)){
        node.remove();
        if(detailHost.classList.contains('slip-overflow-details')){detailHost=page.querySelector('.slip-details');continue;}
        if(detailHost.children.length)break;
        throw Error(model.reference+' contains a detail heading too large to print legibly.');
      }
      entry.value=partThatFits(page,node,entry.value,node.querySelector('p'));entry.continued=true;progressed=true;
      if(!entry.value)details.shift();
    }
    const indexes=[...new Set([...itemHost.children].map(node=>Number(node.dataset.itemIndex)+1))];
    page.querySelector('.slip-item-heading').textContent=indexes.length?`Items ${indexes[0]}${indexes.length>1?'–'+indexes.at(-1):''} of ${model.items.length}`:'Order details';
    if(!detailHost.children.length&&pages.length>1)detailHost.append(detailCard(doc,'Pickup / delivery details','See the earlier slips for this order.'));
    if(!progressed||!fitsSlip(page))throw Error(model.reference+' contains a field too large to print legibly. Shorten that field and try again.');
  }
  pages.forEach((page,i)=>{page.dataset.continuation=String(i>0);page.querySelector('.slip-number').textContent=`Slip ${i+1} of ${pages.length}`;});
  return pages;
}

// Exhaust single-slip layouts before using continuation slips as a last resort.
function paginate(doc, model) {
  const page=createSlip(doc,model);doc.querySelector('#slips').append(page);
  const items=page.querySelector('.slip-items');
  for (const item of model.items) items.append(itemCard(doc, item, item.notes, false, true));
  const hasIcons = items.querySelector('.order-flavor-icon');
  for(const detail of model.details)if(detail.value&&detail.value!=='None')page.querySelector('.slip-details').append(detailCard(doc,detail.title,detail.value));
  page.querySelector('.slip-item-heading').textContent='Items to prepare · '+model.items.length;
  page.querySelector('.slip-footer span:last-child').textContent='Keep with this order';
  for(const mode of ['quarter','quarter-compact','half','half-compact']){
    const half=mode.startsWith('half');page.className='slip'+(half?' slip-half':'')+(mode.endsWith('compact')?' slip-compact':'');
    page.dataset.size=half?'half':'quarter';page.querySelector('.slip-number').textContent=half?'Half-sheet slip':'Quarter-sheet slip';
    if (fitsSlip(page)) return [page];
    if (hasIcons) {
      page.classList.add('slip-text-only');
      if (fitsSlip(page)) return [page];
    }
  }
  page.remove();return overflowSlips(doc,model);
}

async function readyImages(doc) {
  await Promise.all([...doc.images].filter(img => !img.closest('.slip-text-only') || !img.classList.contains('order-flavor-icon')).map(img => new Promise(resolve => {
    let timer;
    const done = () => {
      clearTimeout(timer); img.removeEventListener('load', done); img.removeEventListener('error', done);
      if (!img.complete || !img.naturalWidth) {
        if (img.classList.contains('order-flavor-icon')) img.remove();
        else img.parentElement.textContent = 'Photo unavailable';
      }
      resolve();
    };
    if (img.complete) return done();
    img.addEventListener('load', done); img.addEventListener('error', done);
    timer = setTimeout(done, 8000);
  })));
}

function waitForPreview(preview) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      try {
        if (preview.closed) { clearInterval(timer); resolve(null); return; }
        // Static hosting canonicalizes .html URLs to extensionless paths. Check
        // the same-origin preview document, not an exact pre-redirect URL string.
        const expected=new URL(previewUrl),actual=new URL(preview.location.href);
        if (actual.origin===expected.origin && actual.pathname.replace(/\.html$/,'')===expected.pathname.replace(/\.html$/,'') && preview.document.readyState === 'complete') {
          clearInterval(timer); resolve(preview.document);
        } else if (Date.now() - start > 10000) {
          throw new Error('The print preview could not load. Close it and try printing again.');
        }
      } catch (error) {
        // A redirect can temporarily expose an opaque navigation document.
        // Never read its contents; wait for the expected same-origin page.
        if (error.name === 'SecurityError' && Date.now() - start <= 10000) return;
        clearInterval(timer); reject(error);
      }
    }, 50);
  });
}

function arrangeSheets(doc, slips, paper, orientation) {
  const host = doc.querySelector('#slips');
  host.replaceChildren();
  doc.querySelector('#paper-style').textContent = `@page{size:${paper === 'letter' ? 'Letter' : 'A4'} ${orientation};margin:0}`;
  let sheet=null,occupied=[],count=0;
  for(const slip of slips){
    const slots=slip.dataset.size==='half'?2:1;
    const available=()=>slots===2?[0,2].find(i=>!occupied[i]&&!occupied[i+1]):[0,1,2,3].find(i=>!occupied[i]);
    let position=available();
    if(!sheet||position===undefined){
      sheet=doc.createElement('section');sheet.className='print-sheet';sheet.dataset.paper=paper;
      sheet.setAttribute('aria-label',`Sheet ${++count}`);
      const frame = doc.createElement('div');
      frame.className = 'print-sheet-frame';
      frame.append(sheet);
      host.append(frame);
      occupied=[];position=0;
    }
    slip.style.gridRow=String(Math.floor(position/2)+1);
    slip.style.gridColumn=slots===2?'1 / span 2':String(position%2+1);
    sheet.append(slip);occupied[position]=true;if(slots===2)occupied[position+1]=true;
  }
  return count;
}

// Opening the tab happens synchronously on the click, before optional batch
// loading. This avoids popup blocking while each selected saved order is fetched.
export async function printOrderSlips(source, { products = [], settings = {} } = {}) {
  const preview = window.open(previewUrl, '_blank');
  if (!preview) throw new Error('Allow pop-ups for this site, then try printing again.');
  let doc;
  try {
    doc = await waitForPreview(preview);
    if (!doc) return;
    const button = doc.querySelector('.print-slips'), status = doc.querySelector('[role="status"]');
    const paperChoice = doc.querySelector('#paper-size');
    if (!button || !status || !paperChoice) throw new Error('The print preview could not load. Close it and try printing again.');
    doc.querySelector('.close-preview').addEventListener('click', () => preview.close());
    if (preview.getComputedStyle(doc.documentElement).getPropertyValue('--order-slip-layout').trim() !== 'ready') {
      throw new Error('The print layout could not load. Close this preview and try again.');
    }
    status.textContent = 'Loading selected orders…';
    const loaded = typeof source === 'function' ? await source() : source;
    const orders = Array.isArray(loaded) ? loaded : [loaded];
    if (!orders.length || orders.some(order => !order)) throw new Error('No orders are available to print. Select your orders and try again.');
    if (preview.closed) return;
    const models = orders.map(order => printModel(order, products, settings));
    doc.title = `${models.length === 1 ? models[0].reference : `${models.length} orders`} - preparation slips`;
    status.textContent = 'Preparing order slips…';
    try { if (localStorage.getItem('order-slip-paper') === 'letter') paperChoice.value = 'letter'; } catch { /* Paper choice remains available without storage. */ }
    const device = preview.navigator;
    const portrait = /iPhone|iPad|iPod/i.test(device.userAgent) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1);
    const orientation = portrait ? 'portrait' : 'landscape';
    for (const option of paperChoice.options) option.textContent = `${option.value === 'letter' ? 'Letter' : 'A4'} ${orientation}`;
    doc.documentElement.dataset.orientation = orientation;
    const slipSets = models.map(model => paginate(doc, model));
    await readyImages(doc);
    if (preview.closed) return;
    const copies = doc.querySelector('.print-copies');
    const counts = models.map(model => {
      const label = doc.createElement('label');
      label.textContent = model.reference;
      const input = doc.createElement('input');
      Object.assign(input, { type: 'number', min: '1', max: String(maxCopies), step: '1', value: '1', inputMode: 'numeric' });
      input.setAttribute('aria-label', `Copies of ${model.reference}`);
      label.append(input);
      doc.querySelector('#copy-counts').append(label);
      return input;
    });
    copies.hidden = false;
    copies.open = models.length === 1;
    const resize = () => {
      const [wide, short] = paperDimensions[paperChoice.value] || paperDimensions.a4;
      const width = (portrait ? short : wide) * 96 / 25.4;
      const height = (portrait ? wide : short) * 96 / 25.4;
      const scale = Math.min(1, Math.max(.1, (preview.innerWidth - 24) / width));
      const style = doc.documentElement.style;
      style.setProperty('--preview-width', `${width * scale}px`);
      style.setProperty('--preview-height', `${height * scale}px`);
      style.setProperty('--preview-scale', scale);
    };
    let layoutVersion = 0;
    const arrange = async () => {
      const version = ++layoutVersion;
      button.disabled = true;
      let copyCount = 0;
      const slips = slipSets.flatMap((set, index) => {
        const number = Math.max(1, Math.min(maxCopies, Math.trunc(Number(counts[index].value)) || 1));
        counts[index].value = String(number);
        copyCount += number;
        return Array.from({ length: number }, () => set.map(slip => slip.cloneNode(true))).flat();
      });
      const paper = paperChoice.value === 'letter' ? 'letter' : 'a4';
      const count=arrangeSheets(doc, slips, paper, orientation); resize();
      const copiesText = copyCount > orders.length ? ` · ${copyCount} copies` : '';
      status.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'}${copiesText} · ${slips.length} slip${slips.length === 1 ? '' : 's'} · ${count} sheet${count === 1 ? '' : 's'}. Choose matching paper in the print dialog, ${orientation}, Actual size / 100%, with headers and footers off.`;
      button.textContent = copyCount > orders.length ? `Print ${copyCount} copies` : `Print ${orders.length === 1 ? 'order' : `${orders.length} orders`}`;
      await readyImages(doc);
      if (version === layoutVersion) button.disabled = false;
    };
    await arrange();
    preview.addEventListener('resize', resize);
    for (const input of counts) input.addEventListener('change', arrange);
    paperChoice.addEventListener('change', () => {
      arrange();
      try { localStorage.setItem('order-slip-paper', paperChoice.value); } catch { /* Preferences are optional. */ }
    });
    paperChoice.disabled = false;
    button.addEventListener('click', () => { preview.focus(); preview.print(); });
    preview.focus();
  } catch (error) {
    if (!preview.closed && doc) {
      doc.querySelector('#slips')?.replaceChildren();
      const status = doc.querySelector('[role="status"]');
      if (status) status.textContent = error.message;
    }
    throw error;
  }
}
