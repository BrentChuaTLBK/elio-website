// Valid Elio fixed box: three flavor pieces share flavor-level stock.
export async function accountingFixture(h) {
 const flavor=await h.product({kind:'flavor',price_cents:0,lead_days:0});
 const product=await h.product({kind:'set',price_cents:10000,lead_days:0,box_flavors:[flavor.id,flavor.id,flavor.id]});
 const date=await h.day(2);
 await h.inventory(flavor,date,100);
 return {product,date};
}
