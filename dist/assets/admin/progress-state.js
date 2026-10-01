const ordersKey='elio-admin-orders-view-v1',ordersTtl=30*60*1000;
const payment=['','awaiting_payment','under_review','paid','rejected','cancelled'];
const fulfillment=['','pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery','completed','refunded','cancelled','expired'];
const selected=(value,allowed)=>allowed.includes(value)?value:'';
export function orderFilters(value={}) {
 const date=typeof value.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)&&!Number.isNaN(Date.parse(value.date))&&new Date(value.date).toISOString().slice(0,10)===value.date?value.date:'';
 return {search:typeof value.search==='string'?value.search.slice(0,250):'',payment:selected(value.payment,payment),fulfillment:selected(value.fulfillment,fulfillment),method:selected(value.method,['','pickup','delivery']),refund:selected(value.refund,['','yes','no']),date,upcoming:value.upcoming===true};
}
export function clearAdminOrderView(storage){try{storage?.removeItem(ordersKey);}catch{}}
// One short-lived, same-tab view record. Restore only after staff access succeeds.
export function adminOrderView(storage,{now=()=>Date.now()}={}) {
 const clear=()=>clearAdminOrderView(storage);
 return {
  clear,
  save(userId,view,filters){
   if(!userId||view!=='orders'){clear();return;}
   try{storage?.setItem(ordersKey,JSON.stringify({userId,view:'orders',at:now(),filters:orderFilters(filters)}));}catch{}
  },
  restore(userId){
   try{const saved=JSON.parse(storage?.getItem(ordersKey)||'null');
    if(!userId||saved?.userId!==userId||saved.view!=='orders'||!Number.isFinite(saved.at)||now()<saved.at||now()-saved.at>=ordersTtl){clear();return null;}
    return {view:'orders',filters:orderFilters(saved.filters)};
   }catch{clear();return null;}
  }
 };
}

// These drafts contain quantities and dates only and never leave this page.
export function inventoryMonthDrafts(){
 const saved=new Map();
 return {
  remember(month,{dates,drafts,mode}){saved.set(month,{dates:[...dates],drafts:{...drafts},mode});},
  restore(month,{today,productIds,months}){
   for(const key of saved.keys())if(!months.includes(key))saved.delete(key);
   const value=saved.get(month);if(!value)return {dates:[],drafts:{},mode:'replace',adjusted:false};
   const dates=value.dates.filter(date=>date.startsWith(month+'-')&&date>=today),ids=new Set(productIds);
   const drafts=Object.fromEntries(Object.entries(value.drafts).filter(([id])=>ids.has(id)));
   return {dates,drafts,mode:value.mode==='fill_unconfigured'?'fill_unconfigured':'replace',adjusted:dates.length!==value.dates.length||Object.keys(drafts).length!==Object.keys(value.drafts).length};
  },
  clear(month){saved.delete(month);},
  reset(){saved.clear();}
 };
}
