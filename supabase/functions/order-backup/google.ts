import {env} from '../_shared/http.ts';
import {backupSheetRequests,decodeRecoveryRows} from './sheets.js';
import {BackupError} from './errors.ts';
import {makeProofArchive,sha256} from './proof-archive.ts';
export {BackupError,backupError} from './errors.ts';

const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const utf8=new TextEncoder(),segment=(v:unknown)=>encode(utf8.encode(JSON.stringify(v)));
export function spreadsheetId(value:unknown) {
 if(typeof value!=='string')throw new BackupError('configuration');
 const id=value.startsWith('https://docs.google.com/spreadsheets/d/')?value.split('/')[5]:value;
 if(!/^[A-Za-z0-9_-]{20,150}$/.test(id))throw new BackupError('configuration');return id;
}
export function createGoogleSheets({getEnv=env,request=fetch,now=()=>Date.now()}={}) {
 let cached:{secret:string,value:string,until:number}|null=null;
 function account(){
  const secret=getEnv('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON')||getEnv('GA_SERVICE_ACCOUNT_JSON');
  try{const a=JSON.parse(secret);if(a.type!=='service_account'||!a.client_email?.endsWith('.iam.gserviceaccount.com')||!a.private_key)throw Error();return {secret,...a};}catch{throw new BackupError('configuration');}
 }
 async function token(){
  const a=account();if(cached?.secret===a.secret&&cached.until>now())return cached.value;
  const endpoint='https://oauth2.googleapis.com/token',issued=Math.floor(now()/1000);
  let key;try{key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(a.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);}catch{throw new BackupError('configuration');}
  const unsigned=`${segment({alg:'RS256',typ:'JWT'})}.${segment({iss:a.client_email,scope:'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',aud:endpoint,iat:issued,exp:issued+3600})}`;
  const signature=encode(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8.encode(unsigned))));
  const response=await request(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||typeof data?.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=60)throw new BackupError('access');
  cached={secret:a.secret,value:data.access_token,until:now()+(Math.min(data.expires_in,3600)-60)*1000};return cached.value;
 }
 async function call(id:string,method='GET',body?:any,path=''){
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId(id)}${path||(method==='POST'?':batchUpdate':'?fields=spreadsheetId,sheets(properties)')}`;
  const response=await request(url,{method,redirect:'error',headers:{Authorization:`Bearer ${await token()}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
   if(response.status===401)cached=null;
   const disabled=data?.error?.details?.some((d:any)=>d.reason==='SERVICE_DISABLED')||data?.error?.errors?.some((d:any)=>d.reason==='accessNotConfigured');
   throw new BackupError(disabled?'api_disabled':response.status===429?'quota':[401,403,404].includes(response.status)?'access':'network');
  }
  if(!data)throw new BackupError('network');return data;
 }
 async function driveFile(id:string,bytes?:Uint8Array){
  spreadsheetId(id);
  const path=bytes?`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,size,sha256Checksum`:`https://www.googleapis.com/drive/v3/files/${id}?fields=id,mimeType,parents,size,sha256Checksum,capabilities(canEdit)`;
  const response=await request(path,{method:bytes?'PATCH':'GET',headers:{Authorization:`Bearer ${await token()}`,...(bytes?{'Content-Type':'application/zip'}:{})},...(bytes?{body:bytes}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){const disabled=data?.error?.details?.some((d:any)=>d.reason==='SERVICE_DISABLED')||data?.error?.errors?.some((d:any)=>d.reason==='accessNotConfigured');throw new BackupError(disabled?'api_disabled':response.status===429?'quota':[401,403,404].includes(response.status)?'access':'network');}
  if(!data||data.id!==id)throw new BackupError('readback');return data;
 }
 return {
  info(){try{const a=account();return {configured:true,service_account_email:a.client_email,cloud_project:a.project_id};}catch{return {configured:false};}},
  async verify(id:string){const data=await call(id);for(const name of ['Orders','Items','Affiliates','Recovery','History'])if(!data.sheets?.some((s:any)=>s.properties?.title===name))throw new BackupError('configuration');return data;},
  async write(id:string,snapshot:any,archiveIds:string[]=[]){
   if(archiveIds.length!==2||new Set(archiveIds).size!==2)throw new BackupError('configuration');archiveIds.forEach(spreadsheetId);
   const meta=await call(id);
   const ranges='/values:batchGet?ranges=Recovery!A6:F40005&ranges=History!A6:F40005&valueRenderOption=UNFORMATTED_VALUE';
   const previous=await call(id,'GET',undefined,ranges);
   let earlier:any=null;const previousRows=previous.valueRanges?.[0]?.values||[];
   if(previousRows.length){try{earlier=await decodeRecoveryRows(previousRows);}catch{throw new BackupError('readback');}}
   const target=archiveIds.find(file=>file!==earlier?.proof_archive?.file_id)!;
   // Only these two privately configured file IDs can be overwritten. Google
   // omits parents when the account has file access but no folder access.
   // Do not require broader folder permission to update the approved files.
   const targetMeta=await driveFile(target);if(targetMeta.mimeType!=='application/zip'||!targetMeta.capabilities?.canEdit||(targetMeta.parents&&!targetMeta.parents.includes('1Sh49xlV0ScTwUrH6UC_5EMNehTHBoSIh')))throw new BackupError('configuration');
   const archive=await makeProofArchive(snapshot),checksum=await sha256(archive.bytes);
   await driveFile(target,archive.bytes);
   const stored=await driveFile(target);if(stored.sha256Checksum!==checksum||Number(stored.size)!==archive.bytes.length)throw new BackupError('readback');
   snapshot={...archive.snapshot,proof_archive:{file_id:target,sha256:checksum,bytes:archive.bytes.length,proof_count:archive.proof_count,generated_at:snapshot.generated_at}};
   let requests;
   try{requests=await backupSheetRequests(snapshot,meta.sheets||[],previous.valueRanges?.[0]?.values||[],previous.valueRanges?.[1]?.values||[]);}catch(e){throw new BackupError(e instanceof Error && e.message.includes('too large')?'too_large':'configuration');}
   const result=await call(id,'POST',{requests});
   if(result.spreadsheetId!==id||!Array.isArray(result.replies)||result.replies.length!==requests.length)throw new BackupError('network');
   const readback=await call(id,'GET',undefined,'/values/Recovery!A6:F40005?valueRenderOption=UNFORMATTED_VALUE');
   let recovered;try{recovered=await decodeRecoveryRows(readback.values||[]);}catch{throw new BackupError('readback');}
   if(JSON.stringify(recovered)!==JSON.stringify(snapshot))throw new BackupError('readback');
   return {proof_archive_id:target,proof_count:archive.proof_count};
  }
 };
}
