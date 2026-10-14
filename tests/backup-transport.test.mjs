import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createGoogleSheets} from '../supabase/functions/order-backup/google.ts';
import {decodeRecoveryRows} from '../supabase/functions/order-backup/sheets.js';

const sheet='fixture-spreadsheet-id-0001',ids=['fixture-proof-archive-A-0001','fixture-proof-archive-B-0002'];
const names=['Orders','Items','Affiliates','Recovery','History'];
const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
const account=JSON.stringify({type:'service_account',client_email:'fixture@test.iam.gserviceaccount.com',private_key:key});
const data={schema_version:1,source:'elio-paid-order-recovery',generated_at:new Date().toISOString(),active_count:0,paid_history_count:0,active_total_cents:0,active_order_ids:[],paid_orders:[],review_orders:[],payments:[],allocations:[],products:[],inventory:[],affiliates:[],affiliate_codes:[],affiliate_orders:[],affiliate_order_details:[],affiliate_ledger:[],affiliate_payouts:[]};
let current=[],history=[],mode='',writes=[],batches=0,tokens=0,version=0;
const saved=new Map(),heads=new Map(),revisions=new Map(),pending=new Map(),json=(x,status=200)=>new Response(JSON.stringify(x),{status});
const request=async(url,options={})=>{
 if(url==='https://oauth2.googleapis.com/token'){tokens++;return json({access_token:'fixture-only',token_type:'Bearer',expires_in:3600});}
 assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-only');
 if(url.includes('/drive/v3/files/')){
  const parts=new URL(url).pathname.split('/'),fileAt=parts.indexOf('files'),id=parts[fileAt+1];assert(ids.includes(id));
  if(parts.includes('revisions')){const revision=parts.at(-1);if(options.method==='DELETE'){revisions.delete(revision);return new Response(null,{status:204});}assert.equal(JSON.parse(options.body).keepForever,true);assert(revisions.has(revision));return json({id:revision,keepForever:true});}
  if(options.method==='PATCH'){writes.push(id);if(mode==='upload-failure')return json({},503);pending.set(id,[]);return new Response(null,{status:200,headers:{Location:`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=resumable&upload_id=fixture`}});}
  if(options.method==='PUT'){
   const range=options.headers['Content-Range'].match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);assert(range);pending.get(id).push(options.body);const size=pending.get(id).reduce((n,b)=>n+b.length,0);assert.equal(size,Number(range[2])+1);
   if(range[3]==='*')return new Response(null,{status:308,headers:{Range:`bytes=0-${size-1}`}});
   const bytes=new Uint8Array(size);let at=0;for(const chunk of pending.get(id)){bytes.set(chunk,at);at+=chunk.length;}saved.set(id,bytes);const rev='revision-'+(++version);heads.set(id,rev);revisions.set(rev,bytes);return json({id});
  }
  const bytes=saved.get(id),hash=bytes?createHash('sha256').update(bytes).digest('hex'):null;
  // File-only sharing deliberately omits parents, as observed on live Drive.
  return json({id,mimeType:'application/zip',capabilities:{canEdit:true},...(mode==='wrong-folder'?{parents:['different-folder']}:{}),...(bytes?{size:String(bytes.length),sha256Checksum:mode==='hash-mismatch'?'incorrect':hash,headRevisionId:heads.get(id)}:{})});
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
const first=await client.write(sheet,data,ids);assert.equal(first.proof_archive_id,ids[0]);
const second=await client.write(sheet,{...data,generated_at:new Date(Date.now()+1000).toISOString()},ids,{archiveRevisions:first.proof_archive_revisions});assert.equal(second.proof_archive_id,ids[1]);
assert.deepEqual(writes,ids);assert.equal(tokens,1);assert.equal((await decodeRecoveryRows(current)).proof_archive.file_id,ids[1]);
const currentArchive=saved.get(ids[1]),previousRows=JSON.stringify(current),goodBatches=batches;
for(const failure of ['upload-failure','hash-mismatch','sheet-failure']){
 mode=failure;await assert.rejects(client.write(sheet,data,ids),failure==='hash-mismatch'?/readback/:/network/);
 assert.equal(JSON.stringify(current),previousRows);assert.deepEqual(saved.get(ids[1]),currentArchive);assert.equal(writes.at(-1),ids[0]);assert.equal(batches,goodBatches);
}
mode='wrong-folder';const priorWrites=writes.length;await assert.rejects(client.write(sheet,data,ids),/configuration/);assert.equal(writes.length,priorWrites);
mode='';let guardCalls=0;await assert.rejects(client.write(sheet,data,ids,{checkpoint:async()=>{if(++guardCalls===4)throw Error('lease expired');}}),/lease expired/);assert.equal(JSON.stringify(current),previousRows);assert.deepEqual(saved.get(ids[1]),currentArchive);
const pinned=(await decodeRecoveryRows(current)).proof_archive.revision_id;assert.deepEqual(revisions.get(pinned),currentArchive);
let ticks=0;const expired=createGoogleSheets({getEnv:()=>account,request,now:()=>++ticks<4?0:160000});await assert.rejects(expired.write(sheet,data,ids),/timeout/);assert.equal(JSON.stringify(current),previousRows);
const third=await client.write(sheet,{...data,generated_at:new Date(Date.now()+2000).toISOString()},ids,{archiveRevisions:second.proof_archive_revisions});assert.equal(third.retired_revision,first.proof_archive_revisions[ids[0]]);assert(revisions.has(third.retired_revision));await client.cleanup(third);assert(!revisions.has(third.retired_revision));assert(revisions.has(second.proof_archive_revisions[ids[1]]));assert(revisions.has(third.proof_archive_revisions[ids[0]]));
const beforeCorrupt=writes.length;current[0][5]+='tampered';await assert.rejects(client.write(sheet,data,ids),/readback/);assert.equal(writes.length,beforeCorrupt);
console.log('PASS file-only Drive sharing, archive rotation, Google hash checks, upload/sheet failures preserve current archive, wrong-folder and corrupt-snapshot rejection.');
