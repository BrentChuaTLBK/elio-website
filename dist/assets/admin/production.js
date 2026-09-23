import { isCalendarDate } from './date-calendar.js';

const confirmedStatuses = new Set(['confirmed','preparing','ready_for_pickup','out_for_delivery','completed']);
const total = () => ({ orders:0, boxes:0, pieces:0, fixed:0, custom:0, servedBoxes:0, servedPieces:0, flavors:new Map(), sets:new Map(), missing:[] });
function boxCombination(recipe) {
  const flavors=new Map();
  for(const f of recipe){
    const id=f.product_id || f.name, quantity=Number(f.quantity);
    if(!id||!Number.isInteger(quantity)||quantity<1)continue;
    const row=flavors.get(id)||{id,name:f.name||'Unnamed flavor',quantity:0};
    row.quantity+=quantity;flavors.set(id,row);
  }
  const parts=[...flavors.values()];
  return {
    key:JSON.stringify(parts.map(f=>[f.id,f.quantity]).sort(([a],[b])=>String(a).localeCompare(String(b)))),
    label:parts.sort((a,b)=>a.name.localeCompare(b.name)).map(f=>`${f.quantity} × ${f.name}`).join(' · '),
  };
}
function addOrder(result, order) {
  result.orders++;
  const served=order.fulfillment_status==='completed';
  for (const [index,item] of (order.items || []).entries()) {
    const count=Number(item.quantity);
    if (!Number.isInteger(count) || count<1) continue;
    const custom=item.product_kind ? item.product_kind==='custom_box' : Object.hasOwn(item.selections || {},'flavors');
    result.boxes+=count; result[custom?'custom':'fixed']+=count;
    if(served)result.servedBoxes+=count;
    // Always read the saved order recipe, never the current product definition.
    const recipe=item.flavor_contents || [];
    if (!recipe.length) result.missing.push(order.reference);
    for(const f of recipe) {
      const pieces=Number(f.quantity)*count;
      if(!Number.isInteger(pieces)||pieces<1)continue;
      const key=f.product_id || f.name;
      const row=result.flavors.get(key)||{id:key,name:f.name||'Unnamed flavor',pieces:0,served:0};
      row.pieces+=pieces;if(served)row.served+=pieces;result.flavors.set(key,row);
      result.pieces+=pieces;if(served)result.servedPieces+=pieces;
    }
    const combination=boxCombination(recipe);
    // A custom variant is its flavor counts, independent of selection/slot order.
    // Keep different box products separate; they can have different packaging.
    const key=JSON.stringify([item.product_id||item.name,custom?combination.label?combination.key:['unknown',order.id||order.reference||result.orders,index]:'fixed']);
    const set=result.sets.get(key)||{name:item.name||'Elio box',kind:custom?'Custom box':'Fixed set',combination:custom?(combination.label||'Recipe needs review'):'',boxes:0,served:0};
    set.boxes+=count;if(served)set.served+=count;result.sets.set(key,set);
  }
}
function finish(result) {
  return {...result,flavors:[...result.flavors.values()].sort((a,b)=>a.name.localeCompare(b.name)),sets:[...result.sets.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.combination.localeCompare(b.combination)),missing:[...new Set(result.missing)]};
}
export function buildProduction(orders, from, to) {
  if(!isCalendarDate(from)||!isCalendarDate(to)||from>to)throw new Error('Choose a valid date range, with the start on or before the end.');
  const selected=orders.filter(o=>o.payment_status==='paid'&&!o.refund_label&&confirmedStatuses.has(o.fulfillment_status)&&o.fulfillment_date>=from&&o.fulfillment_date<=to);
  const totals=total(),daily=new Map();
  for(const order of selected){addOrder(totals,order);const day=daily.get(order.fulfillment_date)||total();addOrder(day,order);daily.set(order.fulfillment_date,day);}
  return {...finish(totals),from,to,days:[...daily.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,data])=>({date,...finish(data)}))};
}

export function renderProduction(report,{esc,dateLabel}) {
  const metrics=[['Cheesecake pieces',report.pieces],['Fixed sets',report.fixed],['Custom boxes',report.custom],['Boxes already served',report.servedBoxes]];
  const flavorTable=flavors=>`<div class="table-wrap"><table class="data-table"><thead><tr><th>Flavor</th><th>Total pieces</th><th>Already served</th></tr></thead><tbody>${flavors.map(f=>`<tr><th scope="row">${esc(f.name)}</th><td>${f.pieces}</td><td>${f.served}</td></tr>`).join('')}</tbody></table></div>`;
  const boxTable=sets=>`<div class="table-wrap"><table class="data-table production-boxes"><thead><tr><th>Box / combination</th><th>Total</th><th>Served</th></tr></thead><tbody>${sets.map(s=>`<tr><td><strong>${esc(s.name)}</strong><small>${s.kind}</small>${s.combination?`<p class="production-combination">${esc(s.combination)}</p>`:''}</td><td>${s.boxes}</td><td>${s.served}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="metric-grid">${metrics.map(([name,value])=>`<section class="panel metric-card"><p class="metric-label">${name}</p><p class="metric-value">${value}</p></section>`).join('')}</div><p class="production-note">${report.orders} paid, confirmed order${report.orders===1?'':'s'} · ${report.boxes} boxes · ${esc(dateLabel(report.from))}${report.to!==report.from?' – '+esc(dateLabel(report.to)):''}. Matching custom combinations are grouped by flavor quantities, regardless of arrangement. Served orders are included in the totals and shown separately. Cancelled, expired, refunded, and payment-pending orders are excluded.</p>${report.missing.length?`<p class="notice danger">Some older orders have no saved flavor recipe: ${report.missing.map(esc).join(', ')}. Their boxes are counted, but their flavor pieces need manual review.</p>`:''}${report.orders?`<div class="production-summary-grid"><section class="panel"><h2>Pieces per flavor</h2>${flavorTable(report.flavors)}</section><section class="panel"><h2>Boxes to prepare</h2>${boxTable(report.sets)}</section></div><section class="panel production-daily"><h2>Daily breakdown</h2>${report.days.map(day=>`<details open><summary><strong>${esc(dateLabel(day.date))}</strong><span>${day.boxes} boxes · ${day.pieces} pieces</span></summary><p class="muted">${day.fixed} fixed sets · ${day.custom} custom boxes · ${day.servedBoxes} boxes served</p>${flavorTable(day.flavors)}<h3 class="production-day-boxes">Boxes & combinations</h3>${boxTable(day.sets)}</details>`).join('')}</section>`:'<section class="panel empty-state"><h2>No confirmed production for these dates</h2><p>Paid orders appear here after payment is approved by your team.</p></section>'}`;
}
