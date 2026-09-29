import {validateRecovery,recoveryFlavors,activeRecoveryOrders} from '../../../dist/assets/admin/recovery-data.js';
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function recoveryRows(snapshot){
 validateRecovery(snapshot);const text=JSON.stringify(snapshot),hash=await digest(text),chunks=[];
 for(let i=0;i<text.length;){let end=Math.min(i+28000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push(text.slice(i,end));i=end;}
 return chunks.map((chunk,i)=>[hash.slice(0,24),snapshot.generated_at,i+1,chunks.length,hash,chunk]);
}
export async function decodeRecoveryRows(rows){
 if(!rows.length)throw Error('Missing recovery data');const first=rows[0],count=Number(first[3]);
 if(!Number.isSafeInteger(count)||count<1||rows.length!==count)throw Error('Incomplete recovery data');
 const parts=[];for(let i=0;i<count;i++){const r=rows[i];if(r[0]!==first[0]||r[1]!==first[1]||Number(r[2])!==i+1||Number(r[3])!==count||r[4]!==first[4]||typeof r[5]!=='string')throw Error('Recovery parts mismatch');parts.push(r[5]);}
 const text=parts.join('');if(await digest(text)!==first[4])throw Error('Recovery checksum mismatch');return validateRecovery(JSON.parse(text));
}
export async function backupSheetRequests(snapshot,sheets,previous=[],history=[]){
 validateRecovery(snapshot);const current=await recoveryRows(snapshot),ids=new Set(snapshot.active_order_ids),active=activeRecoveryOrders(snapshot);
 const codes=new Map(snapshot.affiliate_orders.map(o=>[o.order_id,o])),orders=new Map([...snapshot.paid_orders,...(snapshot.review_orders||[]),...snapshot.affiliate_order_details].map(o=>[o.id,o]));
 const php=n=>(Number(n)||0)/100;
 const sheetDefs=[{name:'Orders',note:'Paid and payment-under-review orders awaiting service, including overdue orders. Review does not confirm payment.',headers:['Reference','Date · Manila','Method','Payment status','Customer','Phone','Social','Email','Recipient','Recipient phone','Address','Order details','Products PHP','Discount PHP','Delivery PHP','Total PHP','Paid PHP','Status','Affiliate code','Commission %','Commission status','Instructions','Order ID'],money:[12,13,14,15,16],rows:active.map(o=>{const a=codes.get(o.id)||{};return[o.reference,o.fulfillment_date,o.method,o.payment_status,o.buyer?.name,o.buyer?.phone,[o.buyer?.social_platform,o.buyer?.social_username].filter(Boolean).join(': '),o.buyer?.email,o.recipient?.name,o.recipient?.phone,[o.address?.line1,o.address?.line2,o.address?.locality,o.address?.postal_code].filter(Boolean).join(', '),o.items.map(i=>`${i.quantity} × ${i.name}`).join('\n'),php(o.subtotal_cents),php(o.discount_cents),php(o.delivery_cents),php(o.total_cents),php(o.paid_amount_cents),o.fulfillment_status,a.code,a.commission_bps==null?'':a.commission_bps/100,a.status,o.instructions,o.id];})},
 {name:'Items',note:'Full product and flavor details for the active orders.',headers:['Reference','Date · Manila','Product','Quantity','Flavors / selections','Unit price PHP','Line total PHP','Order ID','Product ID'],money:[5,6],rows:active.flatMap(o=>o.items.map(i=>[o.reference,o.fulfillment_date,i.name,i.quantity,recoveryFlavors(i),php(i.unit_price_cents),php(i.line_total_cents??i.quantity*i.unit_price_cents),o.id,i.product_id]))},
 {name:'Affiliates',note:'Attribution for all affiliate orders. Recovery includes commissions, payouts and the ledger.',headers:['Reference','Date · Manila','Customer','Affiliate code','Affiliate ID','Order total PHP','Commission %','Estimated PHP','Earned PHP','Commission status','Order payment status','Order fulfillment status','Order ID'],money:[5,7,8],rows:snapshot.affiliate_orders.map(a=>{const o=orders.get(a.order_id)||{};return[o.reference||'',o.fulfillment_date||'',o.buyer?.name||'',a.code,a.affiliate_id,php(o.total_cents),a.commission_bps/100,php(a.estimated_cents),php(a.earned_cents),a.status,o.payment_status||'',o.fulfillment_status||'',a.order_id];})},
 {name:'Recovery',note:'Structured order and affiliate recovery. Active payment proofs are in the linked private ZIP archive.',headers:['Snapshot','Generated UTC','Part','Parts','SHA-256','JSON data'],money:[],rows:current}];
 // Keep earlier snapshots for thirty days. A failed atomic request changes no
 // sheet. Corrupt current data is not promoted to recovery history.
 const cutoff=Date.parse(snapshot.generated_at)-30*86400000;let past=history.filter(r=>Date.parse(r[1])>=cutoff);
 if(previous.length){try{await decodeRecoveryRows(previous);if(previous[0][0]!==current[0][0]&&Date.parse(previous[0][1])>=cutoff&&!past.some(r=>r[0]===previous[0][0]))past.push(...previous);}catch{}}
 sheetDefs.push({name:'History',note:'Earlier successful snapshots retained for 30 days. Each includes paid-order history at that time.',headers:['Snapshot','Generated UTC','Part','Parts','SHA-256','JSON data'],money:[],rows:past});
 const requests=[{updateSpreadsheetProperties:{properties:{timeZone:'Asia/Manila'},fields:'timeZone'}}];
 for(const def of sheetDefs){
  const sheet=sheets.find(s=>s.properties?.title===def.name);if(!sheet)throw Error('Backup sheet tab missing: '+def.name);
  if(def.rows.length>39995)throw Error('Backup too large for one spreadsheet.');
  const sheetId=sheet.properties.sheetId,columns=def.headers.length,values=[['ELIO · '+def.name],['Snapshot '+snapshot.generated_at], [def.note],[snapshot.proof_archive?'Payment proofs ('+snapshot.proof_archive.proof_count+')':''],def.headers,...def.rows];
  const rowCount=Math.max(sheet.properties.gridProperties?.rowCount||0,values.length,6),columnCount=Math.max(sheet.properties.gridProperties?.columnCount||0,columns);
  requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount,columnCount,frozenRowCount:5,frozenColumnCount:1}},fields:'gridProperties'}});
  requests.push({updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:rowCount,startColumnIndex:0,endColumnIndex:columnCount},rows:values.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}))})),fields:'userEnteredValue'}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:values.length,startColumnIndex:0,endColumnIndex:columns},cell:{userEnteredFormat:{textFormat:{fontFamily:'Arial',fontSize:11},verticalAlignment:'TOP',wrapStrategy:def.name==='Recovery'||def.name==='History'?'CLIP':'WRAP'}},fields:'userEnteredFormat'}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:columns},cell:{userEnteredFormat:{textFormat:{fontFamily:'Arial',fontSize:11,bold:true},backgroundColor:{red:.94,green:.94,blue:.94},wrapStrategy:'WRAP'}},fields:'userEnteredFormat'}});
  requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:columns},properties:{pixelSize:170},fields:'pixelSize'}});
  requests.push({updateDimensionProperties:{range:{sheetId,dimension:'ROWS',startIndex:0,endIndex:5},properties:{pixelSize:40},fields:'pixelSize'}});
  // Empty neighboring cells let instructions stay readable without merging
  // across the frozen reference column.
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:3,startColumnIndex:0,endColumnIndex:columns},cell:{userEnteredFormat:{wrapStrategy:'OVERFLOW_CELL'}},fields:'userEnteredFormat.wrapStrategy'}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{fontFamily:'Arial',fontSize:14,bold:true}}},fields:'userEnteredFormat.textFormat'}});
  if(def.rows.length)requests.push({updateDimensionProperties:{range:{sheetId,dimension:'ROWS',startIndex:5,endIndex:values.length},properties:{pixelSize:def.name==='Recovery'||def.name==='History'?24:84},fields:'pixelSize'}});
  if(snapshot.proof_archive)requests.push({repeatCell:{range:{sheetId,startRowIndex:3,endRowIndex:4,startColumnIndex:0,endColumnIndex:1},cell:{userEnteredFormat:{textFormat:{link:{uri:'https://drive.google.com/file/d/'+snapshot.proof_archive.file_id+'/view'}}}},fields:'userEnteredFormat.textFormat.link'}});
  for(const col of def.money)if(def.rows.length)requests.push({repeatCell:{range:{sheetId,startRowIndex:5,endRowIndex:values.length,startColumnIndex:col,endColumnIndex:col+1},cell:{userEnteredFormat:{numberFormat:{type:'CURRENCY',pattern:'"₱"#,##0.00'}}},fields:'userEnteredFormat.numberFormat'}});
  requests.push({setBasicFilter:{filter:{range:{sheetId,startRowIndex:4,endRowIndex:Math.max(values.length,6),startColumnIndex:0,endColumnIndex:columns}}}});
 }
 if(new TextEncoder().encode(JSON.stringify(requests)).length>5_000_000)throw Error('Backup too large for one spreadsheet request.');return requests;
}
