import {activeRecoveryOrders,recoveryFlavors,recoveryEnvelope,validateRecovery} from './recovery-data.js';
import {makeProofArchive} from './proof-archive.js';
import {excelLibrary} from './accounting-export.js';

export function buildRecoveryWorkbook(data,ExcelJS){
 validateRecovery(data);const wb=new ExcelJS.Workbook();wb.creator='Elio Basque Cheesecake';wb.created=new Date(data.generated_at);
 const orders=activeRecoveryOrders(data),affiliate=new Map(data.affiliate_orders.map(a=>[a.order_id,a]));
 const sheet=(name,head,rows)=>{const s=wb.addWorksheet(name);s.addRow(head);for(const row of rows)s.addRow(row);s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rowCount),column:head.length}};s.columns=head.map((h,i)=>({width:i===0?24:Math.min(38,Math.max(18,h.length+3))}));s.getRow(1).height=30;s.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF764B25'}};});s.eachRow(r=>r.alignment={vertical:'top',wrapText:true});return s;};
 const o=sheet('Orders',['Order reference','Order ID','Scheduled date · Manila','Method','Payment status','Fulfillment status','Customer','Email','Phone','Social media','Recipient','Recipient phone','Address','Products PHP','Discount PHP','Delivery PHP','Total PHP','Paid PHP','Affiliate code','Commission status','Instructions','Proof path'],orders.map(x=>{const a=affiliate.get(x.id)||{};return [x.reference,x.id,x.fulfillment_date,x.method,x.payment_status,x.fulfillment_status,x.buyer?.name,x.buyer?.email,x.buyer?.phone,[x.buyer?.social_platform,x.buyer?.social_username].filter(Boolean).join(': '),x.recipient?.name,x.recipient?.phone,[x.address?.line1,x.address?.line2,x.address?.locality,x.address?.postal_code].filter(Boolean).join(', '),...[x.subtotal_cents,x.discount_cents,x.delivery_cents,x.total_cents,x.paid_amount_cents].map(n=>(n||0)/100),a.code,a.status,x.instructions,x.proof_path];}));
 for(const n of [14,15,16,17,18])o.getColumn(n).numFmt='"₱"#,##0.00';
 const items=sheet('Items',['Order reference','Product','Quantity','Flavors per box','Unit price PHP','Line total PHP'],orders.flatMap(o=>o.items.map(i=>[o.reference,i.name,i.quantity,recoveryFlavors(i),i.unit_price_cents/100,i.line_total_cents/100])));items.getColumn(5).numFmt=items.getColumn(6).numFmt='"₱"#,##0.00';
 sheet('Read me',['Detail','Value'],[['Generated at',data.generated_at],['Scope',data.download_scope==='all_unserved'?'All unserved orders, including unpaid':'Paid or under-review orders to serve'],['Payment review','Under review does not mean payment is confirmed.'],['Proof images','This workbook contains paths only. Use Download with proofs (ZIP) for actual images.'],['Recovery','The Recovery data tab contains ordered JSON chunks. Join column B from row 2 onward to recover the full snapshot, including affiliate data.'],['Privacy','Keep this workbook private. Customer order access tokens are excluded.']]);
 // Excel limits a cell to 32,767 characters. Chunk the JSON without truncation.
 const json=JSON.stringify(data),chunks=[];for(let i=0;i<json.length;i+=24000)chunks.push([chunks.length+1,json.slice(i,i+24000)]);sheet('Recovery data',['Sequence','JSON chunk'],chunks);
 return wb;
}
export async function recoveryExcel(data){return buildRecoveryWorkbook(data,await excelLibrary()).xlsx.writeBuffer();}
export async function recoveryZip(data,api,{request=fetch,onProgress=()=>{}}={}){
 const orders=activeRecoveryOrders(validateRecovery(data)),byPath=new Map(orders.filter(o=>o.proof_path).map(o=>[o.proof_path,o]));let done=0;
 return makeProofArchive(data,async path=>{
  const order=byPath.get(path);if(!order)throw Error('A payment proof changed. Refresh the backup and try again.');
  onProgress(`Copying payment proof ${++done} of ${byPath.size}…`);
  const signed=await api('proof_url',{order_id:order.id});const u=new URL(signed.url);
  const expected='/storage/v1/object/sign/payment-proofs/'+path;
  if(u.protocol!=='https:'||u.username||u.password||u.hostname!=='dzxyhckkkrzqpwpavngn.supabase.co'||decodeURIComponent(u.pathname)!==expected)throw Error('The payment proof changed. Refresh the backup and try again.');
  const response=await request(u.toString(),{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok||!response.body)throw Error('An attached payment proof could not be downloaded. Try again.');
  const reader=response.body.getReader(),parts=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>5*1024*1024){await reader.cancel();throw Error('The payment proof exceeds the download limit.');}parts.push(r.value);}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;
 });
}
export const recoveryJson=async data=>JSON.stringify(await recoveryEnvelope(data),null,2);
