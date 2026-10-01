import {credentials} from '../_shared/http.ts';
import {BackupError,makeProofArchive as buildArchive} from '../../../dist/assets/admin/proof-archive.js';
export {MAX_ARCHIVE_BYTES,zipFiles,sha256} from '../../../dist/assets/admin/proof-archive.js';
const MAX_PROOF_BYTES=20*1024*1024;
async function bounded(response:Response){
 if(!response.ok||!response.body||Number(response.headers.get('content-length'))>MAX_PROOF_BYTES)throw new BackupError('proof_files');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>MAX_PROOF_BYTES){await reader.cancel();throw new BackupError('proof_files');}chunks.push(r.value);}
 const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return bytes;
}
export async function readProof(path:string,{request=fetch,getCredentials=credentials}={}){
 const {url,key}=getCredentials();const result=await request(`${url}/storage/v1/object/authenticated/payment-proofs/${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});return bounded(result);
}

export const makeProofArchive=(snapshot:any,download=readProof)=>buildArchive(snapshot,download);
