// Retry uses the unchanged checkout idempotency key. A rejected validation is
// different from losing the response after the server may have saved the order.
export function checkoutFailure(error){
 const uncertain=error?.uncertain===true || (!error?.code && /fetch|network|connection|timeout|timed out|load failed/i.test(error?.message||''));
 // Only a definite server rejection permits replacing the submitted quote.
 if(!uncertain&&error?.code==='P0001'&&/Prices or availability changed since review\. Review your order again\./.test(error?.message||''))return {message:error.message,button:'Review updated total',reviewAgain:true};
 return uncertain
  ? {message:'We couldn’t confirm your order. It may already be saved. Your details are still here; try again to check or finish placing the same order.',button:'Try again'}
  : {message:error?.message||'Your order could not be placed. Check your details and try again.',button:'Retry submission'};
}
