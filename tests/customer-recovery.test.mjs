import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {flavorPickerLimit} from '../dist/assets/shop/basket-interactions.js';
import {checkoutFailure} from '../dist/assets/shop/checkout-recovery.js';
import {queueNewsletterActivation,clearNewsletterActivation,resumeNewsletterActivation} from '../dist/assets/shop/newsletter-activation.js';
const date='2026-10-04',flavor={id:'v',name:'Vanilla',active:true},products=[{id:'set',kind:'set',flavor_contents:[{...flavor,quantity:3}]},{id:'custom',kind:'custom_box',option_groups:[{id:'flavors',choices:[flavor]}]}];
const inventory=remaining=>[{product_id:'v',date,available:true,capacity:remaining,remaining}];
assert.equal(flavorPickerLimit([],products,flavor,1,inventory(1),date).maximum,1);
assert.equal(flavorPickerLimit([],products,flavor,2,inventory(3),date).maximum,1);
const basket=[{product_id:'set',quantity:1},{product_id:'custom',quantity:2,selections:{flavors:{v:1}}}];
assert.deepEqual(flavorPickerLimit(basket,products,flavor,2,inventory(8),date),{remaining:3,maximum:1});
assert.equal(flavorPickerLimit(basket,products,flavor,1,inventory(4),date).maximum,0);
assert.equal(flavorPickerLimit([],products,flavor,1,inventory(null),date).maximum,Infinity);
assert.equal(flavorPickerLimit([],products,{...flavor,active:false},1,inventory(9),date).maximum,0);
const priceError={code:'P0001',message:'Prices or availability changed since review. Review your order again.'};
assert.equal(checkoutFailure(priceError).reviewAgain,true);
for(const error of [{...priceError,uncertain:true},{message:priceError.message},{...priceError,code:'PGRST000'},{code:'P0001',message:'Invalid email.'},{uncertain:true,message:'Connection interrupted'}])assert.notEqual(checkoutFailure(error).reviewAgain,true);

// Deterministic lifecycle checks: requests survive navigation without storing
// emails/tokens, never switch account identity, and retry within a bounded window.
const values=new Map(),timers=new Map();let clock=1000,nextId=0;
const originals={setTimeout,clearTimeout,now:Date.now,storage:Object.getOwnPropertyDescriptor(globalThis,'localStorage')};
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
globalThis.setTimeout=(fn,ms)=>{const id=++nextId;timers.set(id,{fn,at:clock+ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);Date.now=()=>clock;
const tick=async(ms=0)=>{clock+=ms;for(const [id,t]of [...timers])if(t.at<=clock){timers.delete(id);void t.fn();}await flush();await flush();};
const session=id=>({user:{id,email:id+'@example.test',user_metadata:{newsletter_opt_in:false}},access_token:'never-store-this'});
let current=session('a'),calls=0,completed=0;
const auth={getSession:async()=>({data:{session:current},error:null})};
try{
 queueNewsletterActivation(current);assert(!JSON.stringify([...values]).includes('example.test'));assert(!JSON.stringify([...values]).includes('never-store-this'));
 let stop=resumeNewsletterActivation({auth,activate:async()=>{calls++;return {status:'not_subscribed'};},onSuccess:()=>completed++});await tick();assert.equal(calls,1);assert.equal(completed,1);stop();
 stop=resumeNewsletterActivation({auth,activate:async()=>{calls++;}});await tick();assert.equal(calls,1);stop();
 clearNewsletterActivation('a');queueNewsletterActivation(session('a'));current=session('b');stop=resumeNewsletterActivation({auth,activate:async()=>{calls++;}});await tick();assert.equal(calls,1);stop();
 current=session('a');let release;stop=resumeNewsletterActivation({auth,activate:()=>{calls++;return new Promise(r=>release=r);}});await tick();assert.equal(calls,2);stop();
 // A new page resumes only after the persisted retry time; no duplicate immediate call.
 let resumed=0;const stopNext=resumeNewsletterActivation({auth,activate:async()=>{resumed++;return {status:'subscribed'};}});await tick();assert.equal(resumed,0);await tick(60000);assert.equal(resumed,1);release({status:'subscribed'});await flush();stopNext();
 clearNewsletterActivation('a');queueNewsletterActivation(current);let failed=0;stop=resumeNewsletterActivation({auth,activate:signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')))),onFailure:()=>failed++});await tick();await tick(12000);assert.equal(failed,1);assert([...timers.values()].some(t=>t.at===clock+60000));stop();
 clearNewsletterActivation('a');queueNewsletterActivation(current);let successForOldUser=0;stop=resumeNewsletterActivation({auth,activate:()=>new Promise(r=>release=r),onSuccess:()=>successForOldUser++});await tick();current=session('b');release({status:'subscribed'});await flush();assert.equal(successForOldUser,0);stop();clearNewsletterActivation('a');
 console.log('PASS customer recovery: shared stock, definite price re-review, durable newsletter retries, consent-neutral payloads and account identity checks.');
}finally{globalThis.setTimeout=originals.setTimeout;globalThis.clearTimeout=originals.clearTimeout;Date.now=originals.now;if(originals.storage)Object.defineProperty(globalThis,'localStorage',originals.storage);else delete globalThis.localStorage;}
