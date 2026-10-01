const key='elio-account-return-v1',ttl=30*60*1000;
// Keep the provider callback on its existing exact allowlisted URL. Only a
// short-lived local intent carries the return to the shop through OAuth/email.
export function accountReturn({customer,search,received,storage,now=()=>Date.now()}) {
  const requested=customer&&new URLSearchParams(search).get('next')==='order.html';
  let stored=false;
  if(customer&&received)try{const value=JSON.parse(storage?.getItem(key)||'null');stored=value?.next==='order.html'&&Number.isFinite(value.at)&&now()>=value.at&&now()-value.at<ttl;}catch{}
  const toShop=requested||stored;
  return {
    toShop,destination:toShop?'order.html#your-basket':'account.html',
    remember(){try{if(toShop)storage?.setItem(key,JSON.stringify({next:'order.html',at:now()}));else storage?.removeItem(key);}catch{}},
    clear(){try{storage?.removeItem(key);}catch{}}
  };
}
export function temporaryOrderReadFailure(error) {
  if([401,403].includes(Number(error?.status))||['42501','PGRST301','PGRST302','PGRST303'].includes(error?.code))return false;
  return error?.uncertain===true||(!error?.code&&!error?.status)||[408,429,500,502,503,504].includes(Number(error?.status));
}
