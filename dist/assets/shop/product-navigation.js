// Product dialogs occupy one browser-history entry when opened from the shop.
// Direct product links can close in place without sending customers elsewhere.
export function productNavigation({dialog,findProduct,showProduct,onUnavailable=()=>{}}) {
  let current='',closing=false,queued='';
  const requested=()=>new URL(location.href).searchParams.get('product');
  const shopUrl=()=>{const url=new URL(location.href);url.searchParams.delete('product');return url.pathname+url.search+url.hash;};
  const focusProduct=id=>document.querySelector(`[data-product="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
  function hide(){const id=current;current='';if(dialog.open)dialog.close();if(id)focusProduct(id);}
  function restore(){
    closing=false;
    const value=requested(),product=value&&findProduct(value);
    if(!product){
      hide();
      if(value){history.replaceState({...history.state,elioProduct:null},'',shopUrl());onUnavailable();}
    }else if(current!==product.id||!dialog.open){current=product.id;showProduct(product.id);}
    if(queued){const id=queued;queued='';open(id);}
  }
  function open(id){
    if(closing){queued=id;return;}
    const product=findProduct(id);if(!product)return;
    if(current===product.id&&dialog.open)return;
    const url=new URL(location.href);url.searchParams.set('product',product.id);
    const state={...history.state,elioProduct:{id:product.id,fromShop:true}};
    if(dialog.open)history.replaceState(state,'',url.pathname+url.search+url.hash);
    else history.pushState(state,'',url.pathname+url.search+url.hash);
    current=product.id;showProduct(product.id);
  }
  function close(){
    if(closing)return;
    const owned=history.state?.elioProduct?.fromShop&&requested();
    hide();
    if(owned){closing=true;history.back();}
    else history.replaceState({...history.state,elioProduct:null},'',shopUrl());
  }
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  window.addEventListener('popstate',restore);
  return {open,close,restore};
}
