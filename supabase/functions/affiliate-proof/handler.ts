import {credentials,endpoint,field,HttpError,json,readBody,readJson,service,storageRequest,uuid,verifiedUser} from '../_shared/http.ts';
import {imageType,validateImage,MAX_IMAGE_BYTES} from '../_shared/images.ts';

const bucket='affiliate-payout-proofs';
const digest=async (bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export const handle=endpoint(async(request,headers)=>{
 const user_id=await verifiedUser(request,true);
 const type=request.headers.get('content-type')||'';
 if(type.startsWith('application/json')){
  const input=await readJson(request);
  if(input.action!=='receipt')throw new HttpError(400,'Choose a receipt to view.');
  const id=uuid(input.id,'Payout ID');
  const result=await service('affiliate_proof_read',{user_id,id});
  const affiliate=uuid(result?.affiliate_id,'Affiliate ID'),path=result?.path;
  if(typeof path!=='string'||!new RegExp(`^${affiliate}/${id}/[a-f0-9-]{36}\\.(png|jpg|webp)$`).test(path))throw new HttpError(404,'Payout receipt unavailable.');
  const signed=await storageRequest(`object/sign/${bucket}/${path}`,'POST',JSON.stringify({expiresIn:300}),'application/json');
  const signedPath=signed?.signedURL||signed?.signedUrl;
  if(typeof signedPath!=='string')throw new HttpError(502,'Could not open this receipt. Please try again.');
  return json({url:signedPath.startsWith('https://')?signedPath:`${credentials().url}/storage/v1${signedPath}`,expires_in:300},200,headers);
 }
 if(!type.startsWith('multipart/form-data;'))throw new HttpError(400,'Upload one payment receipt image.');
 const bytes=await readBody(request,MAX_IMAGE_BYTES+65536);
 let form:FormData;
 try{form=await new Response(bytes,{headers:{'Content-Type':type}}).formData();}catch{throw new HttpError(400,'The upload form is invalid.');}
 const file=form.get('file');
 if(!(file instanceof File)||form.getAll('file').length!==1)throw new HttpError(400,'Choose one payment receipt image.');
 if(file.size>MAX_IMAGE_BYTES)throw new HttpError(413,'Receipt images must be 5 MB or smaller.');
 const contents=new Uint8Array(await file.arrayBuffer()),image=imageType(contents);
 const id=uuid(form.get('id'),'Payout ID'),affiliate_id=uuid(form.get('affiliate_id'),'Affiliate ID');
 const amount=field(form.get('amount_cents'),'Payout amount',9,true);
 if(!/^[1-9]\d{0,8}$/.test(amount))throw new HttpError(400,'Enter a positive payout amount.');
 const payload={id,affiliate_id,amount_cents:Number(amount),paid_on:field(form.get('paid_on'),'Payment date',10,true),
  payment_method:field(form.get('payment_method'),'Payment method',20,true),reference:field(form.get('reference'),'Payment reference',200),note:field(form.get('note'),'Notes',2000)};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.paid_on))throw new HttpError(400,'Enter a valid payment date.');
 const request_hash=await digest(new TextEncoder().encode(JSON.stringify({...payload,file_digest:await digest(contents)})));
 const authorization=await service('affiliate_authorize_payout',{...payload,user_id,request_hash});
 if(authorization?.recorded)return json({payout:publicPayout(authorization.payout)},200,headers);
 if(authorization?.allowed!==true)throw new HttpError(403,'Only an owner can record affiliate payments.');
 await validateImage(contents);
 const path=`${affiliate_id}/${id}/${crypto.randomUUID()}.${image.extension}`;
 await storageRequest(`object/${bucket}/${path}`,'POST',contents,image.mime);
 try{
  // Recheck balance under the database lock after upload. Concurrent payouts or
  // refund reversals cannot let this operation spend the same earnings twice.
  const result=await service('affiliate_commit_payout',{...payload,user_id,request_hash,path});
  if(result?.recorded!==true||!result.payout?.id)throw new HttpError(502,'Payment recording was not confirmed. Retry with the same details.');
  if(result.path!==path)await cleanup(path);
  return json({payout:publicPayout(result.payout)},201,headers);
 }catch(error){
  if(error instanceof HttpError && error.status>=400 && error.status<500){await cleanup(path);throw error;}
  // A timeout may happen after commit. Check by the same fingerprint before
  // removing the object, so an accepted payout never loses its receipt.
  try{
   const recovered=await service('affiliate_authorize_payout',{...payload,user_id,request_hash});
   if(recovered?.recorded){if(recovered.path!==path)await cleanup(path);return json({payout:publicPayout(recovered.payout)},200,headers);}
   await cleanup(path);
  }catch{/* Keep a private orphan on an ambiguous network failure; never delete an accepted receipt. */}
  throw error;
 }
});
function publicPayout(value:any){const {proof_path,request_hash,created_by,voided_by,...payout}=value||{};return payout;}
async function cleanup(path:string){try{await storageRequest(`object/${bucket}`,'DELETE',JSON.stringify({prefixes:[path]}),'application/json');}catch{/* Private orphan retained for later maintenance. */}}
