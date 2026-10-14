import {BackupError,googleError} from './errors.ts';
const CHUNK=8*1024*1024;
async function* chunks(stream:AsyncIterable<Uint8Array>){
 // uploadResumable holds exactly one lookahead chunk. Alternate two buffers
 // only after the preceding request resolves, avoiding full-archive churn.
 const buffers=[new Uint8Array(CHUNK),new Uint8Array(CHUNK)];let slot=0,buffer=buffers[slot],used=0;
 for await(const bytes of stream){let at=0;while(at<bytes.length){const n=Math.min(CHUNK-used,bytes.length-at);buffer.set(bytes.subarray(at,at+n),used);at+=n;used+=n;if(used===CHUNK){yield buffer;slot=1-slot;buffer=buffers[slot];used=0;}}}
 if(used)yield buffer.subarray(0,used);
}
export async function uploadResumable({id,stream,request=fetch,authorization,checkpoint}:{id:string,stream:AsyncIterable<Uint8Array>,request?:typeof fetch,authorization:()=>Promise<string>,checkpoint:()=>Promise<void>}){
 await checkpoint();const headers={Authorization:await authorization()};
 const begin=await request(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=resumable&fields=id,size,sha256Checksum,headRevisionId`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json','X-Upload-Content-Type':'application/zip'},body:JSON.stringify({mimeType:'application/zip'}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!begin.ok)throw new BackupError(googleError(begin.status,await begin.json().catch(()=>null)));
 let session:URL;try{session=new URL(begin.headers.get('Location')||'');}catch{throw new BackupError('configuration');}
 if(session.protocol!=='https:'||session.hostname!=='www.googleapis.com'||session.port||session.username||session.password||session.pathname!==`/upload/drive/v3/files/${id}`)throw new BackupError('configuration');
 const iterator=chunks(stream)[Symbol.asyncIterator]();let current=await iterator.next(),offset=0;
 try{
  while(!current.done){
   const next=await iterator.next(),value=current.value,end=offset+value.length,total=next.done?String(end):'*';let sent=offset,attempts=0;
   while(sent<end){
    await checkpoint();let response:Response;
    try{response=await request(session.toString(),{method:'PUT',headers:{...headers,'Content-Type':'application/zip','Content-Range':`bytes ${sent}-${end-1}/${total}`},body:value.subarray(sent-offset),redirect:'error',signal:AbortSignal.timeout(25000)});}catch{response=new Response(null,{status:503});}
    if(response.status>=500){
     if(++attempts>3)throw new BackupError('network');await checkpoint();
     response=await request(session.toString(),{method:'PUT',headers:{...headers,'Content-Length':'0','Content-Range':`bytes */${total}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    }
    if(response.status===200||response.status===201){if(!next.done)throw new BackupError('readback');const final=await response.json().catch(()=>null);if(final?.id!==id)throw new BackupError('readback');sent=end;}
    else if(response.status===308){const range=response.headers.get('Range'),match=range?.match(/^bytes=0-(\d+)$/),accepted=match?Number(match[1])+1:range?NaN:0;if(!Number.isSafeInteger(accepted)||accepted<sent||accepted>end)throw new BackupError('readback');if(accepted===sent&&++attempts>3)throw new BackupError('network');if(accepted===end&&next.done)throw new BackupError('readback');sent=accepted;}
    else throw new BackupError(response.status===404?'network':googleError(response.status,await response.json().catch(()=>null)));
   }
   offset=end;current=next;
  }
  return offset;
 }finally{await iterator.return?.();}
}
