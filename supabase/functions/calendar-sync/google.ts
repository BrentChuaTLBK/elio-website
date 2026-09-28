import {env} from '../_shared/http.ts';

export type CalendarErrorCode = 'access' | 'api_disabled' | 'configuration' | 'network' | 'quota' | 'conflict';
export class CalendarError extends Error {
  code: CalendarErrorCode;
  status: number;
  constructor(code: CalendarErrorCode, status=502) {super(code);this.code=code;this.status=status;}
}
export const calendarError = (error: unknown): CalendarErrorCode => error instanceof CalendarError ? error.code : 'network';
export const calendarId = (value: unknown) => {
  if(typeof value!=='string')throw new CalendarError('configuration',400);
  let id=value.trim();
  if(id.startsWith('https://calendar.google.com/')){
    try {id=new URL(id).searchParams.get('src')||'';}catch{throw new CalendarError('configuration',400);}
  }
  if(id.length>512||!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(id))throw new CalendarError('configuration',400);
  return id;
};
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const utf8=new TextEncoder();
const segment=(value:unknown)=>encode(utf8.encode(JSON.stringify(value)));
const clean=(value:unknown,max=2000)=>typeof value==='string'?value.slice(0,max):'';
const html=(value:unknown)=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const phone=(order:any)=>clean(order.method==='delivery'?order.recipient?.phone:order.buyer?.phone,80);
const name=(order:any)=>clean(order.method==='delivery'?order.recipient?.name:order.buyer?.name,200)||'Customer';
export function eventBody(order:any,eventId:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(order?.date)||!['pickup','delivery'].includes(order.method))throw new CalendarError('configuration');
  const start=new Date(`${order.date}T00:00:00Z`);
  if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==order.date)throw new CalendarError('configuration');
  const end=new Date(start.getTime()+86400000).toISOString().slice(0,10);
  const delivery=order.method==='delivery',area=clean(order.address?.locality,100)||'Area not recorded';
  const address=delivery?[order.address?.line1,order.address?.line2,order.address?.locality,order.address?.postal_code].filter(Boolean).map(v=>clean(v)).join(', '):clean(order.pickup_address);
  const detail=[`${delivery?'Delivery':'Pickup'} · ${clean(order.reference,80)}`,`Status: ${clean(order.status,80).replaceAll('_',' ')}`,
    `${delivery?'Recipient':'Customer'}: ${name(order)}`,`Phone: ${phone(order)}`,`Buyer: ${clean(order.buyer?.name,200)}`,
    `Buyer phone: ${clean(order.buyer?.phone,80)}`,`Email: ${clean(order.buyer?.email,254)}`,
    `${delivery?'Address':'Pickup location'}: ${address}`,`Window: ${clean(order.window,200)||'See order details'}`,
    '', 'Items:',...(Array.isArray(order.items)?order.items.map((item:any)=>`${Number(item.quantity)||0} × ${clean(item.name,200)}`):[]),
    '',`Instructions: ${clean(order.instructions)||'None'}`,'','Reschedule and update this order in Elio. Google changes to this order event are replaced by the saved Elio order.'];
  const url=`https://eliocheesecakes.com/manage.html#calendar?date=${order.date}&order=${encodeURIComponent(order.id)}`;
  return {id:eventId,summary:`${delivery?`Delivery · ${area}`:'Pickup'} · ${clean(order.reference,80)} · ${name(order)}`.slice(0,500),
    description:detail.map(html).join('\n'),location:address,colorId:delivery?'9':'2',
    start:{date:order.date},end:{date:end},visibility:'private',transparency:'transparent',status:'confirmed',
    reminders:{useDefault:false},attendees:[],source:{title:'Open in Elio',url},
    extendedProperties:{private:{elio_source:'elio-orders',elio_order_id:order.id}}};
}

export function createGoogleCalendar({getEnv=env,request=(...args:Parameters<typeof fetch>)=>fetch(...args),now=()=>Date.now()}={}) {
  let cached:{secret:string;value:string;until:number}|null=null;
  function account(){
    const secret=getEnv('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON')||getEnv('GA_SERVICE_ACCOUNT_JSON');
    try {
      const value=JSON.parse(secret);
      if(value.type!=='service_account'||typeof value.client_email!=='string'||!value.client_email.endsWith('.iam.gserviceaccount.com')||typeof value.private_key!=='string')throw Error();
      return {secret,...value};
    }catch{throw new CalendarError('configuration',503);}
  }
  async function token(){
    const data=account();
    if(cached?.secret===data.secret&&cached.until>now())return cached.value;
    let key;
    try {
      const bytes=Uint8Array.from(atob(data.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
      key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    }catch{throw new CalendarError('configuration',503);}
    const issued=Math.floor(now()/1000),endpoint='https://oauth2.googleapis.com/token';
    const unsigned=`${segment({alg:'RS256',typ:'JWT'})}.${segment({iss:data.client_email,scope:'https://www.googleapis.com/auth/calendar.events',aud:endpoint,iat:issued,exp:issued+3600})}`;
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8.encode(unsigned));
    let response;
    try{response=await request(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${encode(new Uint8Array(signature))}`}),signal:AbortSignal.timeout(10000)});}catch{throw new CalendarError('network');}
    const result=await response.json().catch(()=>null);
    if(!response.ok||typeof result?.access_token!=='string'||result.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(result.expires_in)||result.expires_in<=60)throw new CalendarError('access',403);
    cached={secret:data.secret,value:result.access_token,until:now()+(Math.min(result.expires_in,3600)-60)*1000};return cached.value;
  }
  async function call(id:string,path='',{method='GET',body,query={}}:{method?:string;body?:any;query?:Record<string,string>}={}) {
    const access=await token(),url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId(id))}/events${path}`);
    for(const [key,value]of Object.entries(query))url.searchParams.set(key,value);
    if(method!=='GET')url.searchParams.set('sendUpdates','none');
    let response;
    try{response=await request(url.href,{method,redirect:'error',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});}catch{throw new CalendarError('network');}
    const data=response.status===204?null:await response.json().catch(()=>null);
    if(response.ok)return {status:response.status,data};
    if([404,409,410].includes(response.status))return {status:response.status,data:null};
    if(response.status===401)cached=null;
    const reasons=Array.isArray(data?.error?.errors)?data.error.errors.map((v:any)=>v.reason):[];
    const details=Array.isArray(data?.error?.details)?data.error.details.map((v:any)=>v.reason):[];
    const code=details.includes('SERVICE_DISABLED')||reasons.includes('accessNotConfigured')?'api_disabled':response.status===429||reasons.some((v:string)=>/rateLimit|quota/i.test(v))?'quota':[401,403].includes(response.status)?'access':'network';
    throw new CalendarError(code,response.status);
  }
  return {
    info(){try{const value=account();return {configured:true,service_account_email:value.client_email,cloud_project:value.project_id||''};}catch{return {configured:false,service_account_email:null,cloud_project:null};}},
    async changes(id:string,syncToken:string|null,pageToken:string|null){
      const query:Record<string,string>={maxResults:'250',showDeleted:'true'};
      if(syncToken)query.syncToken=syncToken;if(pageToken)query.pageToken=pageToken;
      const result=await call(id,'',{query});
      if(result.status===410)return {reset:true};
      if(result.status!==200||(result.data?.items!==undefined&&!Array.isArray(result.data.items))||(!result.data?.nextPageToken&&!result.data?.nextSyncToken))throw new CalendarError(result.status===404?'access':'network');
      return {reset:false,changes:(result.data.items||[]).map((e:any)=>({event_id:e.id,etag:e.etag,deleted:e.status==='cancelled'})),next_page:result.data.nextPageToken||null,next_sync:result.data.nextSyncToken||null};
    },
    async sync(id:string,job:any){
      if(!/^[a-v0-9]{5,1024}$/.test(job.event_id))throw new CalendarError('configuration');
      const path=`/${job.event_id}`;
      let existing=await call(id,path);
      if(existing.status===410||existing.data?.status==='cancelled')return {recreate:Boolean(job.desired),etag:null};
      if(existing.status===200){
        const props=existing.data?.extendedProperties?.private;
        if(props?.elio_source!=='elio-orders'||props.elio_order_id!==job.order_id)throw new CalendarError('conflict');
      }else if(existing.status!==404)throw new CalendarError('network');
      if(!job.desired){
        if(existing.status===200){const deleted=await call(id,path,{method:'DELETE'});if(![200,204,404,410].includes(deleted.status))throw new CalendarError('network');}
        return {etag:null};
      }
      const body=eventBody(job.desired,job.event_id);
      let updated=await call(id,existing.status===200?path:'',{method:existing.status===200?'PUT':'POST',body});
      if(updated.status===409){
        existing=await call(id,path);
        if(existing.status===410||existing.data?.status==='cancelled')return {recreate:true};
        if(existing.data?.extendedProperties?.private?.elio_source!=='elio-orders'||existing.data?.extendedProperties?.private?.elio_order_id!==job.order_id)throw new CalendarError('conflict');
        updated=await call(id,path,{method:'PUT',body});
      }
      if([404,410].includes(updated.status))return {recreate:true};
      if(![200,201].includes(updated.status)||typeof updated.data?.etag!=='string')throw new CalendarError('network');
      return {etag:updated.data.etag};
    },
    async verify(id:string){
      const identifier=calendarId(id),eventId='eliocheck'+crypto.randomUUID().replaceAll('-','');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(now());
      const body={...eventBody({id:'connection-check',date:today,method:'pickup',reference:'CONNECTION CHECK',status:'completed',buyer:{name:'Elio calendar connection check'},items:[]},eventId),summary:'Elio calendar connection check',description:'Temporary connection verification. This event is removed immediately.'};
      const inserted=await call(identifier,'',{method:'POST',body});
      if(![200,201].includes(inserted.status))throw new CalendarError('access',403);
      try {
        const updated=await call(identifier,`/${eventId}`,{method:'PUT',body});
        if(![200,201].includes(updated.status))throw new CalendarError('access',403);
      } finally {
        const removed=await call(identifier,`/${eventId}`,{method:'DELETE'});
        if(![200,204,404,410].includes(removed.status))throw new CalendarError('network');
      }
      return {calendar_id:identifier,verified:true};
    },
  };
}
