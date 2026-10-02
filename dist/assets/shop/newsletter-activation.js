// Only a user ID and retry timing cross navigation. The endpoint checks the
// current authenticated account and its existing consent; this queue adds none.
const key='elio-newsletter-activation-v1',maxAge=86400000;
let memory;
function storage(){try{return globalThis.localStorage;}catch{return null;}}
function read(){try{return JSON.parse(storage()?.getItem(key)||'null')||memory;}catch{return memory;}}
function save(job){memory=job;try{if(job)storage()?.setItem(key,JSON.stringify(job));else storage()?.removeItem(key);}catch{}}
function valid(job){return job&&typeof job.userId==='string'&&Number.isFinite(job.at)&&Date.now()>=job.at&&Date.now()-job.at<maxAge;}
export function queueNewsletterActivation(session){
  if(!session?.user?.id)return;
  save({userId:session.user.id,at:Date.now(),attempts:0,nextAt:0});
}
export function clearNewsletterActivation(userId){if(read()?.userId===userId)save(null);}
export function resumeNewsletterActivation({auth,activate,onSuccess=()=>{},onFailure=()=>{}}){
  let running=false,timer=null,stopped=false;
  const schedule=delay=>{clearTimeout(timer);if(!stopped)timer=setTimeout(run,delay);};
  async function run(){
    if(stopped||running)return;
    let job=read();if(job&&!valid(job)){save(null);job=null;}if(job?.done)return;
    running=true;
    try{
      const current=await auth.getSession(),session=current.data?.session;
      if(current.error||!session?.user?.id)return;
      // Auth stores explicit signup consent even when local queue storage fails.
      if(!job&&session.user.user_metadata?.newsletter_opt_in===true){queueNewsletterActivation(session);job=read();}
      if(!valid(job)||job.userId!==session.user.id)return;
      if(job.nextAt>Date.now()){schedule(job.nextAt-Date.now());return;}
      // Save the retry before starting, so a navigation or closed tab cannot lose it.
      const retry={...job,attempts:Math.min(Number(job.attempts||0)+1,10),nextAt:Date.now()+60000};save(retry);
      const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),12000);
      try{
        const result=await activate(controller.signal);
        const latest=await auth.getSession();
        if(latest.error||latest.data?.session?.user?.id!==job.userId)return;
        // Another tab may have queued a newer request while this one ran.
        if(read()?.at===job.at&&read()?.userId===job.userId)save({...retry,done:true,nextAt:Date.now()+maxAge});
        onSuccess(result);
      }catch(error){
        onFailure(error);
        if(read()?.at===job.at&&read()?.userId===job.userId&&retry.attempts<4)schedule(60000);
      }finally{clearTimeout(deadline);}
    }catch{if(job&&Number(job.attempts||0)<4)schedule(60000);}
    finally{running=false;}
  }
  const wake=()=>{if(globalThis.document?.hidden)return;const job=read();if(job?.done)return;schedule(0);};
  globalThis.addEventListener?.('online',wake);
  globalThis.document?.addEventListener('visibilitychange',wake);
  schedule(0);
  return ()=>{stopped=true;clearTimeout(timer);globalThis.removeEventListener?.('online',wake);globalThis.document?.removeEventListener('visibilitychange',wake);};
}
