import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createGoogleSheets} from '../supabase/functions/order-backup/google.ts';
import {decodeRecoveryRows} from '../supabase/functions/order-backup/sheets.js';

const sheet='fixture-spreadsheet-id-0001',ids=['fixture-proof-archive-A-0001','fixture-proof-archive-B-0002'];
const names=['Orders','Items','Affiliates','Recovery','History'];
const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
const account=JSON.stringify({type:'service_account',client_email:'fixture@test.iam.gserviceaccount.com',private_key:key});
const data={schema_version:1,source:'elio-paid-order-recovery',generated_at:new Date().toISOString(),active_count:0,paid_history_count:0,active_total_cents:0,active_order_ids:[],paid_orders:[],review_orders:[],payments:[],allocations:[],products:[],inventory:[],affiliates:[],affiliate_codes:[],affiliate_orders:[],affiliate_order_details:[],affiliate_ledger:[],affiliate_payouts:[]};
let current=[],history=[],mode='',writes=[],batches=0,tokens=0;
const saved=new Map(),json=(x,status=200)=>new Response(JSON.stringify(x),{status});
const request=async(url,options={})=>{
 if(url==='https://oauth2.googleapis.com/token'){tokens++;return json({access_token:'fixture-only',token_type:'Bearer',expires_in:3600});}
 assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-only');
 if(url.includes('/drive/v3/files/')){
  const id=new URL(url).pathname.split('/').at(-1);assert(ids.includes(id));
  if(options.method==='PATCH'){writes.push(id);if(mode==='upload-failure')return json({},503);saved.set(id,options.body);}
  const bytes=saved.get(id),hash=bytes?createHash('sha256').update(bytes).digest('hex'):null;
  // File-only sharing deliberately omits parents, as observed on live Drive.
  return json({id,mimeType:'application/zip',capabilities:{canEdit:true},...(mode==='wrong-folder'?{parents:['different-folder']}:{}),...(bytes?{size:String(bytes.length),sha256Checksum:mode==='hash-mismatch'?'incorrect':hash}:{})});
 }
 assert(url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/'+sheet));
 if(url.includes('values:batchGet'))return json({valueRanges:[{values:current},{values:history}]});
 if(url.includes('/values/Recovery'))return json({values:current});
 if(options.method==='POST'){
  if(mode==='sheet-failure')return json({},503);
  const {requests}=JSON.parse(options.body);batches++;
  for(const req of requests){const update=req.updateCells;if(!update)continue;const values=update.rows.slice(5).map(row=>row.values.map(cell=>cell.userEnteredValue?.stringValue??cell.userEnteredValue?.numberValue??''));if(update.range.sheetId===3)current=values;if(update.range.sheetId===4)history=values;}
  return json({spreadsheetId:sheet,replies:requests.map(()=>({}))});
 }
 return json({spreadsheetId:sheet,sheets:names.map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:100,columnCount:26}}}))});
};
const client=createGoogleSheets({getEnv:()=>account,request});
assert.equal((await client.write(sheet,data,ids)).proof_archive_id,ids[0]);
assert.equal((await client.write(sheet,{...data,generated_at:new Date(Date.now()+1000).toISOString()},ids)).proof_archive_id,ids[1]);
assert.deepEqual(writes,ids);assert.equal(tokens,1);assert.equal((await decodeRecoveryRows(current)).proof_archive.file_id,ids[1]);
const currentArchive=saved.get(ids[1]),previousRows=JSON.stringify(current),goodBatches=batches;
for(const failure of ['upload-failure','hash-mismatch','sheet-failure']){
 mode=failure;await assert.rejects(client.write(sheet,data,ids),failure==='hash-mismatch'?/readback/:/network/);
 assert.equal(JSON.stringify(current),previousRows);assert.deepEqual(saved.get(ids[1]),currentArchive);assert.equal(writes.at(-1),ids[0]);assert.equal(batches,goodBatches);
}
mode='wrong-folder';const priorWrites=writes.length;await assert.rejects(client.write(sheet,data,ids),/configuration/);assert.equal(writes.length,priorWrites);
mode='';current[0][5]+='tampered';await assert.rejects(client.write(sheet,data,ids),/readback/);assert.equal(writes.length,priorWrites);
console.log('PASS file-only Drive sharing, archive rotation, Google hash checks, upload/sheet failures preserve current archive, wrong-folder and corrupt-snapshot rejection.');
