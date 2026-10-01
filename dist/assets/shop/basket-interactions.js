import {flavorStock} from './shop-rules.js';

export function selectionKey(selections={}) {
  return JSON.stringify(Object.entries(selections||{}).map(([group,choices])=>[group,Object.entries(choices||{}).filter(([,count])=>Number(count)>0).map(([id,count])=>[id,Number(count)]).sort(([a],[b])=>a.localeCompare(b))]).filter(([,choices])=>choices.length).sort(([a],[b])=>a.localeCompare(b)));
}
export const basketLineKey=line=>JSON.stringify([line.product_id,selectionKey(line.selections)]);
export function mergeBasketItems(items,maximum=Infinity) {
  const merged=[],groups=new Map();
  for(const line of items){
    const key=basketLineKey(line),quantity=Number(line.quantity),group=groups.get(key)||[],existing=group.find(row=>row.quantity+quantity<=maximum);
    if(existing)existing.quantity+=quantity;
    else {const row={...line,quantity};merged.push(row);group.push(row);groups.set(key,group);}
  }
  return merged;
}
function recipe(product,line) {
  return product?.kind==='set'?product.flavor_contents||[]:Object.entries(line.selections?.flavors||{}).filter(([,count])=>Number(count)>0).map(([id,quantity])=>({...product?.option_groups?.find(g=>g.id==='flavors')?.choices.find(f=>f.id===id),id,quantity:Number(quantity)}));
}
// Capacity is shared across every basket line using the same flavor.
export function basketIncreaseLimit(items,index,products,inventory,date) {
  const line=items[index],product=products.find(p=>p.id===line?.product_id);
  if(!line||!product)return {maximum:Number(line?.quantity||0),message:'This box is no longer available.'};
  const otherDemand=new Map();
  items.forEach((other,i)=>{if(i===index)return;const p=products.find(p=>p.id===other.product_id);for(const f of recipe(p,other)){const id=f.product_id||f.id;otherDemand.set(id,(otherDemand.get(id)||0)+Number(f.quantity)*Number(other.quantity));}});
  const ownRecipe=new Map();
  for(const f of recipe(product,line)){const id=f.product_id||f.id,existing=ownRecipe.get(id);if(existing)existing.quantity+=f.quantity;else ownRecipe.set(id,{...f});}
  let maximum=999,limitingFlavor='';
  for(const [id,f] of ownRecipe){
    const limit=Math.max(0,Math.floor((flavorStock(f,date,inventory)-(otherDemand.get(id)||0))/Number(f.quantity)));
    if(limit<maximum){maximum=limit;limitingFlavor=f.name||f.label||'a selected flavor';}
  }
  const message=Number(line.quantity)<maximum?'':maximum>=999?'You’ve reached the maximum of 999 boxes per selection.':`Another box needs more ${limitingFlavor||'flavor stock'} than is left${date?' for this date':''}. Choose another date to order more.`;
  return {maximum,message};
}

const draftKey='elio-product-drafts-v1',draftAge=24*60*60*1000;
export function productDrafts(storage,now=()=>Date.now()) {
  let drafts={};
  try{const stored=JSON.parse(storage?.getItem(draftKey)||'null');if(stored&&typeof stored==='object'&&!Array.isArray(stored))drafts=stored;}catch{}
  const persist=()=>{try{storage?.setItem(draftKey,JSON.stringify(drafts));}catch{}};
  const prune=()=>{for(const [id,draft] of Object.entries(drafts))if(!draft||!Number.isFinite(draft.saved_at)||now()-draft.saved_at<0||now()-draft.saved_at>=draftAge)delete drafts[id];};
  return {
    read(product,date,inventory){
      prune();const draft=drafts[product.id];if(!draft)return null;
      const selected={},original=draft.selections||{};
      for(const group of product.option_groups||[]){
        const choices={};let remaining=Number(group.required_count);
        for(const choice of group.choices){
          const value=Number(original[group.id]?.[choice.id]);
          if(!Number.isInteger(value)||value<=0||choice.active===false)continue;
          const count=Math.max(0,Math.min(value,remaining,flavorStock(choice,date,inventory)));
          if(count){choices[choice.id]=count;remaining-=count;}
        }
        selected[group.id]=choices;
      }
      const quantity=Number.isInteger(draft.quantity)?Math.max(1,Math.min(999,draft.quantity)):1;
      return {selected,quantity,adjusted:selectionKey(selected)!==selectionKey(original)||quantity!==draft.quantity};
    },
    save(id,selections,quantity){prune();drafts[id]={selections:structuredClone(selections),quantity:Number(quantity)||1,saved_at:now()};persist();},
    clear(id){delete drafts[id];persist();}
  };
}
