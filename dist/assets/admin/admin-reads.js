import {normalizeAnalytics,normalizeProduction} from './scoped-reports.js';

// A signed-in dashboard keeps report/page data until refresh or a successful
// mutation. Authorization is still checked by each API call; sign-out clears
// this memory along with the dashboard's catalog and operational state.
export function createAdminReads(api){
  const cache=new Map(),pending=new Map();let generation=0;
  const key=(view,params)=>view+':'+JSON.stringify(params);
  const actions={orders:'admin_order_page',analytics:'admin_analytics',production:'admin_production'};
  function peek(view,params){return cache.get(key(view,params));}
  function load(view,params){
    const id=key(view,params),epoch=generation;
    if(cache.has(id))return Promise.resolve(cache.get(id));
    if(pending.has(id))return pending.get(id);
    const work=api(actions[view],params).then(value=>{
      const result=view==='analytics'?normalizeAnalytics(value):view==='production'?normalizeProduction(value):value;
      if(epoch===generation)cache.set(id,result);return result;
    }).finally(()=>{if(epoch===generation)pending.delete(id);});
    pending.set(id,work);return work;
  }
  function invalidate(){generation++;cache.clear();pending.clear();}
  return {peek,load,invalidate,key};
}
