import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createGoogleCalendar,calendarId,eventBody,CalendarError} from '../supabase/functions/calendar-sync/google.ts';
import {syncCalendar} from '../supabase/functions/calendar-sync/handler.ts';
import {calendarCopy,calendarMonth,filteredCalendarOrders} from '../dist/assets/admin/order-calendar.js';
const order={id:'00000000-0000-4000-8000-000000000001',reference:'ELIO-FIXTURE',date:'2026-09-30',method:'delivery',status:'confirmed',buyer:{name:'Buyer',email:'fixture@example.test',phone:'09170000000'},recipient:{name:'<Recipient>',phone:'09171111111'},address:{line1:'12 Test St',locality:'Makati'},items:[{name:'Box',quantity:2}],window:'9 AM – 6 PM'};
const job={order_id:order.id,event_id:'elio00000000000040008000000000000001g0',desired:order};
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const secret=JSON.stringify({type:'service_account',client_email:'test@fixture.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'}),project_id:'fixture'});
function fixture(sequence){const calls=[];let tokens=0;const client=createGoogleCalendar({getEnv:name=>name==='GA_SERVICE_ACCOUNT_JSON'?secret:'',request:async(url,options)=>{
 if(url==='https://oauth2.googleapis.com/token'){tokens++;const claims=JSON.parse(Buffer.from(new URLSearchParams(options.body).get('assertion').split('.')[1],'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/calendar.events');return Response.json({access_token:'test-token',token_type:'Bearer',expires_in:3600});}
 calls.push({url:new URL(url),...options});const item=sequence.shift();assert.ok(item,'Unexpected request');assert.equal(options.method,item.method);return item.status===204?new Response(null,{status:204}):Response.json(item.data||{},{status:item.status||200});
 }});return {client,calls,tokens:()=>tokens};}
const owned={etag:'old',extendedProperties:{private:{elio_source:'elio-orders',elio_order_id:order.id}}};
assert.equal(calendarId('https://calendar.google.com/calendar/embed?src=elio.cheesecakes%40gmail.com'),'elio.cheesecakes@gmail.com');
assert.throws(()=>calendarId('https://evil.test/'),CalendarError);
const body=eventBody(order,job.event_id);assert.equal(body.end.date,'2026-10-01');assert.equal(body.colorId,'9');assert.match(body.description,/&lt;Recipient&gt;/);assert.deepEqual(body.attendees,[]);assert.equal(body.visibility,'private');
assert.equal(eventBody({...order,method:'pickup'},job.event_id).colorId,'2');
assert.match(calendarCopy(order),/Address: 12 Test St, Makati/);assert.equal(calendarMonth('2024-02').days,29);
assert.equal(filteredCalendarOrders([order],{search:'makati'}).length,1);
{
 const f=fixture([{method:'GET',data:{nextSyncToken:'cursor'}},{method:'GET',status:410}]);
 assert.deepEqual((await f.client.changes('elio@example.test',null,null)).changes,[]);
 assert.equal((await f.client.changes('elio@example.test','expired',null)).reset,true);assert.equal(f.tokens(),1);
}
{
 const f=fixture([{method:'GET',status:404},{method:'POST',status:409},{method:'GET',data:owned},{method:'PUT',data:{etag:'updated'}}]);
 assert.equal((await f.client.sync('elio@example.test',job)).etag,'updated');
 assert(f.calls.filter(c=>c.method!=='GET').every(c=>c.url.searchParams.get('sendUpdates')==='none'));
}
{
 const f=fixture([{method:'GET',data:{etag:'unrelated'}}]);await assert.rejects(f.client.sync('elio@example.test',job),e=>e.code==='conflict');assert.equal(f.calls.length,1);
 const removed=fixture([{method:'GET',data:owned},{method:'DELETE',status:204}]);await removed.client.sync('elio@example.test',{...job,desired:null});
 const deleted=fixture([{method:'GET',status:410}]);assert.equal((await deleted.client.sync('elio@example.test',job)).recreate,true);
}
{
 const f=fixture([{method:'POST',status:201},{method:'PUT',status:403,data:{error:{message:'secret provider message'}}},{method:'DELETE',status:204}]);
 await assert.rejects(f.client.verify('elio@example.test'),e=>e.code==='access'&&!e.message.includes('secret'));assert.equal(f.calls.at(-1).method,'DELETE');
 const disabled=fixture([{method:'GET',status:403,data:{error:{details:[{reason:'SERVICE_DISABLED'}]}}}]);await assert.rejects(disabled.client.changes('elio@example.test',null,null),e=>e.code==='api_disabled');
}
{
 const actions=[];const dispatch=async(action,payload)=>{actions.push({action,payload});if(action==='calendar_begin')return {connected:true,calendar_id:'fixture@example.test',lease_token:'lease'};if(action==='calendar_jobs')return [job,{...job,event_id:'bad'}];return {};};
 await syncCalendar({changes:async()=>({changes:[],next_sync:'cursor'}),sync:async(id,j)=>{if(j.event_id==='bad')throw new CalendarError('quota');return {etag:'success'};}},dispatch);
 assert(actions.some(a=>a.action==='calendar_ack'));assert.equal(actions.find(a=>a.action==='calendar_fail').payload.error,'quota');assert.equal(actions.at(-1).action,'calendar_finish');
}
console.log('PASS calendar: private event data, colors, copy helpers, OAuth scope, empty calendars, expired cursors, duplicate recovery, event ownership, deletion, connection cleanup, retries.');
