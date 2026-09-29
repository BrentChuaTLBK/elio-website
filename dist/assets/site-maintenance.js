import {api,configured,escapeHtml as esc} from './admin/client.js';
const date=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
let current=null,pending=false,timer,signature='';
function render(){
 if(!current)return;
 let banner=document.querySelector('#site-maintenance-banner');
 if(!banner){banner=document.createElement('aside');banner.id='site-maintenance-banner';banner.setAttribute('aria-label','Website maintenance');document.body.prepend(banner);}
 banner.hidden=!current.active&&!current.announce;
 const time=current.starts_at?`${date(current.starts_at)}${current.ends_at?' – '+date(current.ends_at):''} · Manila time`:'';
 banner.innerHTML=`<strong>${current.active?'Website maintenance':'Planned maintenance'}</strong><span>${esc(current.message)}</span>${time?`<span>${esc(time)}</span>`:''}${current.active&&current.uploads_paused?'<span>Payment-proof uploads and deadlines are paused.</span>':''}`;
 const file=location.pathname.split('/').pop().replace(/\.html$/,'')||'index';
 const existingOrder=file==='order'&&new URLSearchParams(location.hash.slice(1)).has('order');
 const block=current.active&&['index','story','flavors','box','order',''].includes(file)&&!existingOrder;
 let screen=document.querySelector('#site-maintenance-screen');
 if(!screen){screen=document.createElement('section');screen.id='site-maintenance-screen';document.body.append(screen);}
 screen.hidden=!block;document.body.classList.toggle('site-under-maintenance',block);
 if(block){document.querySelectorAll('dialog[open]').forEach(d=>d.close());screen.innerHTML=`<div class="maintenance-brand">ELIO<small>BASQUE CHEESECAKE</small></div><div class="maintenance-content"><p>BACK SOON</p><h1>A little care behind the scenes.</h1><p>${esc(current.message)}</p>${current.ends_at?`<p>Expected to reopen ${esc(date(current.ends_at))} · Manila time.</p>`:'<p>We’ll reopen as soon as our updates are complete.</p>'}<p>Existing orders remain available.${current.uploads_paused?' Payment-proof uploads are paused, and your remaining upload time is protected.':''}</p><div><a href="account.html">Your account & orders</a><a href="mailto:elio.cheesecakes@gmail.com">Contact Elio</a></div><button type="button" data-maint-check>Check again</button></div>`;screen.querySelector('button').onclick=refresh;}
 const next=JSON.stringify([current.active,current.uploads_paused]);if(next!==signature){signature=next;window.dispatchEvent(new CustomEvent('elio-maintenance-change',{detail:current}));}
}
async function refresh(){
 if(!configured||pending)return;pending=true;
 try{current=await api('site_status');render();clearTimeout(timer);const server=Date.parse(current.server_time);const boundary=[current.starts_at,current.ends_at].map(Date.parse).filter(t=>Number.isFinite(t)&&t>server).sort((a,b)=>a-b)[0];timer=setTimeout(refresh,Math.max(1000,Math.min(30000,Number.isFinite(boundary)?boundary-server+150:30000)));}
 catch{timer=setTimeout(refresh,30000);}finally{pending=false;}
}
window.addEventListener('hashchange',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();
