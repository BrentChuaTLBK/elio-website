import {credentials,endpoint,HttpError,json,readJson,service,verifiedUser} from '../_shared/http.ts';
import {createGoogleSheets,backupError,spreadsheetId} from './google.ts';
const google=createGoogleSheets();
async function workerAuthorized(token:string){
 const {url,key}=credentials();const result=await fetch(`${url}/rest/v1/rpc/elio_backup_worker_authorized`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_token:token}),signal:AbortSignal.timeout(8000)});
 return result.ok&&await result.json()===true;
}
export async function syncBackup(client=google,dispatch=service,force=false){
 const info=client.info();if(info.configured)await dispatch('order_backup_identity',info);
 const start=await dispatch('order_backup_begin',{force});if(start.skipped)return start;
 let error:string|null=null,proof:any={};
 try{proof=await client.write(start.spreadsheet_id,start.snapshot,start.proof_archive_file_ids)||{};}catch(e){error=backupError(e);}
 const connection=await dispatch('order_backup_finish',{lease_token:start.lease_token,revision:start.revision,snapshot_at:start.snapshot.generated_at,active_count:start.snapshot.active_count,active_review_count:start.snapshot.active_review_count||0,paid_history_count:start.snapshot.paid_history_count,...proof,error});
 return {ok:!error,connection};
}
export const handle=endpoint(async(request,headers)=>{
 const token=request.headers.get('x-worker-token');
 if(token!==null){if(!/^[a-f0-9]{64}$/.test(token)||!await workerAuthorized(token))throw new HttpError(401,'Backup worker authorization required.');return json(await syncBackup(),200,headers);}
 const user_id=await verifiedUser(request,true),access=await service('order_backup_owner_access',{user_id});
 if(access?.allowed!==true)throw new HttpError(403,'Owner access required.');
 const input=await readJson(request);
 if(input.action==='info')return json({...google.info(),connection:access.connection},200,headers);
 if(input.action==='sync')return json(await syncBackup(google,service,true),200,headers);
 if(input.action==='connect'){
  const id=spreadsheetId(input.spreadsheet_id);await google.verify(id);await service('order_backup_connect',{user_id,spreadsheet_id:id});return json(await syncBackup(google,service,true),200,headers);
 }
 throw new HttpError(400,'Choose a backup action.');
});
