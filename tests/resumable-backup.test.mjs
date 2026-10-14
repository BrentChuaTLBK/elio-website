import assert from 'node:assert/strict';
import {uploadResumable} from '../supabase/functions/order-backup/resumable.ts';
const id='fixture-proof-archive-0001',session=`https://www.googleapis.com/upload/drive/v3/files/${id}?upload_id=fixture`,source=new Uint8Array(17*1024*1024+7);for(let i=0;i<source.length;i++)source[i]=i%251;
const stream=async function*(){yield source.subarray(0,100);yield source.subarray(100);};
for(const scenario of ['normal','partial','ambiguous','quota','storage-quota','expired','bad-range','bad-location','lost-lease']){
 let accepted=0,calls=0,guards=0,retried=false;const received=new Uint8Array(source.length);
 const request=async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-only');
  if(options.method==='PATCH')return new Response(null,{status:200,headers:{Location:scenario==='bad-location'?'https://evil.example/upload':session}});
  calls++;if(scenario==='quota')return new Response(null,{status:429});if(scenario==='storage-quota')return Response.json({error:{errors:[{reason:'storageQuotaExceeded'}]}},{status:403});if(scenario==='expired')return new Response(null,{status:404});if(scenario==='bad-range')return new Response(null,{status:308,headers:{Range:'bytes=0-999999999'}});
  const range=options.headers['Content-Range'];if(range.startsWith('bytes */'))return new Response(null,{status:308,headers:{Range:`bytes=0-${accepted-1}`}});
  const [,startText,endText,total]=range.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/),start=Number(startText),end=Number(endText);assert.equal(start,accepted);assert(end-start+1<=8*1024*1024);if(total==='*')assert.equal((end+1)%262144,0);
  let n=options.body.length;if((scenario==='partial'||scenario==='ambiguous')&&!retried){n=262144;retried=true;}received.set(options.body.subarray(0,n),accepted);accepted+=n;
  if(scenario==='ambiguous'&&calls===1)throw Error('response lost');
  if(total!=='*'&&accepted===Number(total))return Response.json({id});
  return new Response(null,{status:308,headers:{Range:`bytes=0-${accepted-1}`}});
 };
 const run=()=>uploadResumable({id,stream:stream(),request,authorization:async()=> 'Bearer fixture-only',checkpoint:async()=>{if(scenario==='lost-lease'&&++guards===3)throw Error('lease expired');}});
 if(['normal','partial','ambiguous'].includes(scenario)){assert.equal(await run(),source.length);assert.deepEqual(received,source);}
 else await assert.rejects(run(),scenario.includes('quota')?/quota/:scenario==='bad-range'?/readback/:scenario==='bad-location'?/configuration/:scenario==='lost-lease'?/lease expired/:/network/);
}
console.log('PASS bounded resumable chunks, acknowledged-offset retries, ambiguous responses, quota/session failures, range and session-origin validation, and lease loss.');
