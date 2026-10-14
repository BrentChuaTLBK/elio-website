import {BackupError,MAX_ARCHIVE_BYTES,MAX_RECOVERY_BYTES,MAX_PROOF_BYTES,MAX_PROOF_FILES,MAX_PROOF_PARTS,MAX_RECOVERY_JSON_BYTES,sha256} from './proof-archive.js';
import {activeRecoveryOrders,validateRecovery} from './recovery-data.js';
import {crc32} from '../vendor/crc-32-1.2.2/crc32.js';

const decoder=new TextDecoder('utf-8',{fatal:true});
const bad=()=>{throw new BackupError('readback');};
const bytes=async blob=>new Uint8Array(await blob.arrayBuffer());
const checksums=new WeakMap();
const checkedBytes=async blob=>{const value=await bytes(blob);if(checksums.has(blob)&&crc32(value)!==checksums.get(blob))bad();return value;};
// Read only the bounded central directory and one entry at a time. Both the
// original flat stored ZIP and version 2 partitioned ZIP use this subset.
async function directory(blob,maximum=MAX_RECOVERY_BYTES){
 if(!(blob instanceof Blob)||blob.size<22||blob.size>maximum)bad();
 const end=new DataView(await blob.slice(-22).arrayBuffer());
 if(end.getUint32(0,true)!==0x06054b50||end.getUint16(4,true)||end.getUint16(6,true)||end.getUint16(20,true))bad();
 const count=end.getUint16(10,true),size=end.getUint32(12,true),offset=end.getUint32(16,true);
 if(count!==end.getUint16(8,true)||count>MAX_PROOF_FILES+4||size>4*1024*1024||offset+size!==blob.size-22)bad();
 const data=await bytes(blob.slice(offset,offset+size)),view=new DataView(data.buffer),entries=new Map();let at=0,previousEnd=0;
 for(let i=0;i<count;i++){
  if(at+46>data.length||view.getUint32(at,true)!==0x02014b50)bad();
  const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),length=view.getUint32(at+24,true),nameLength=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),start=view.getUint32(at+42,true);
  if((flags!==0x800&&flags!==0x808)||method!==0||length!==view.getUint32(at+20,true)||at+46+nameLength+extra+comment>data.length||start<previousEnd)bad();
  const name=decoder.decode(data.subarray(at+46,at+46+nameLength));if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.startsWith('/')||name.includes('..')||entries.has(name))bad();
  const header=await bytes(blob.slice(start,start+30+nameLength)),local=new DataView(header.buffer);
  if(header.length!==30+nameLength||local.getUint32(0,true)!==0x04034b50||local.getUint16(6,true)!==flags||local.getUint16(8,true)!==0||local.getUint16(26,true)!==nameLength||local.getUint16(28,true)||decoder.decode(header.subarray(30))!==name)bad();
  const from=start+30+nameLength,to=from+length,descriptor=flags&8?16:0;if(to+descriptor>offset)bad();
  if(descriptor){const d=new DataView(await blob.slice(to,to+16).arrayBuffer());if(d.getUint32(0,true)!==0x08074b50||d.getUint32(4,true)!==view.getUint32(at+16,true)||d.getUint32(8,true)!==length||d.getUint32(12,true)!==length)bad();}
  else if(local.getUint32(14,true)!==view.getUint32(at+16,true)||local.getUint32(18,true)!==length||local.getUint32(22,true)!==length)bad();
  const entry=blob.slice(from,to);checksums.set(entry,view.getUint32(at+16,true));entries.set(name,entry);previousEnd=to+descriptor;at+=46+nameLength+extra+comment;
 }
 if(at!==data.length||previousEnd!==offset)bad();return entries;
}
async function json(blob,maximum=MAX_RECOVERY_JSON_BYTES){if(!blob||blob.size>maximum)bad();try{return JSON.parse(decoder.decode(await checkedBytes(blob)));}catch{bad();}}
async function verified(blob,expected,maximum){if(!blob||!Number.isSafeInteger(expected.bytes)||blob.size!==expected.bytes||blob.size>maximum||!/^[a-f0-9]{64}$/.test(expected.sha256)||await sha256(await checkedBytes(blob))!==expected.sha256)bad();}

export async function readRecoveryArchive(input){
 const blob=input instanceof Blob?input:new Blob([input]),outer=await directory(blob),envelope=await json(outer.get('recovery.json'));
 if(!envelope?.backup||await sha256(new TextEncoder().encode(JSON.stringify(envelope.backup)))!==envelope.sha256)bad();
 const snapshot=validateRecovery(envelope.backup),proofs=snapshot.proof_files;if(!Array.isArray(proofs)||proofs.length>MAX_PROOF_FILES)bad();
 const restored=[],paths=new Set(),used=new Set(),expected=new Map(),byPart=new Map();let format=1;
 for(const order of activeRecoveryOrders(snapshot)){
  if(order.payment_status==='under_review'&&!order.proof_path)bad();
  for(const path of [order.proof_path,...snapshot.payments.filter(p=>p.order_id===order.id).map(p=>p.proof_path)].filter(Boolean))expected.set(path,order.id);
 }
 for(const proof of proofs){if(!byPart.has(proof.part))byPart.set(proof.part,[]);byPart.get(proof.part).push(proof);}
 if(outer.has('manifest.json')){
  const manifest=await json(outer.get('manifest.json'));if(manifest.source!=='elio-proof-archive'||manifest.format_version!==2||snapshot.archive_format_version!==2||!Array.isArray(manifest.parts)||manifest.parts.length>MAX_PROOF_PARTS||manifest.proof_count!==proofs.length)bad();format=2;
  if(manifest.recovery?.file!=='recovery.json')bad();await verified(outer.get('recovery.json'),manifest.recovery,MAX_RECOVERY_JSON_BYTES);
  for(const part of manifest.parts){
   if(!/^proof-parts\/part-\d{4}\.zip$/.test(part.file)||used.has(part.file))bad();used.add(part.file);
   const partBlob=outer.get(part.file);await verified(partBlob,part,MAX_ARCHIVE_BYTES);const inner=await directory(partBlob,MAX_ARCHIVE_BYTES),listed=byPart.get(part.file)||[];
   if(part.proof_count!==listed.length||inner.size!==listed.length)bad();
   for(const proof of listed){await check(proof,inner.get(proof.file));}
  }
  if(restored.length!==proofs.length||[...outer.keys()].some(n=>!['manifest.json','recovery.json','README.txt','payment-proofs-index.csv'].includes(n)&&!used.has(n)))bad();
 }else{
  for(const proof of proofs){if(proof.part)bad();await check(proof,outer.get(proof.file));}
  if([...outer.keys()].some(n=>!['recovery.json','README.txt','payment-proofs-index.csv'].includes(n)&&!proofs.some(p=>p.file===n)))bad();
 }
 async function check(proof,file){
  if(typeof proof.path!=='string'||!proof.path.startsWith(proof.order_id+'/')||!/^[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,100}\.(png|jpe?g|heic|heif|webp)$/i.test(proof.path)||paths.has(proof.path)||expected.get(proof.path)!==proof.order_id)bad();
  paths.add(proof.path);await verified(file,proof,MAX_PROOF_BYTES);restored.push({path:proof.path,order_id:proof.order_id,blob:file,sha256:proof.sha256});
 }
 if(paths.size!==expected.size)bad();
 for(const name of ['README.txt','payment-proofs-index.csv'])if(outer.has(name)){const file=outer.get(name);if(file.size>MAX_RECOVERY_JSON_BYTES)bad();await checkedBytes(file);}
 return {format_version:format,snapshot,proofs:restored};
}
