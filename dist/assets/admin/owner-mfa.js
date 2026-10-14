// Owner second-factor setup/challenge. The server independently enforces AAL2.
// Setup secrets stay in this page's memory/DOM and are never persisted or logged.
export function mountOwnerMfa(root,{auth,api,onVerified}){
 let disposed=false,busy=false,pendingFactor=null,verifiedFactors=[],ownerId=null,setup=null,epoch=0;
 const $=s=>root.querySelector(s);
 const help='<details class="owner-mfa-help"><summary>Lost access to your authenticator?</summary><p>If you saved your setup key, add it to a replacement authenticator. Otherwise, ask your Supabase project administrator to reset your authenticator and revoke your old sessions. A password reset does not remove this protection.</p></details>';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function message(text,error=false){const e=$('[data-mfa-status]');if(!e)return;e.textContent=text;e.classList.toggle('danger',error);e.hidden=!text;}
 function controls(value){busy=value;root.setAttribute('aria-busy',String(value));root.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);}
 async function sameUser(){const {data,error}=await auth.getSession();if(disposed||error||!data?.session||data.session.user.id!==ownerId)throw Error('Your sign-in changed. Reload this page and sign in again.');}
 async function run(task){if(busy||disposed)return;controls(true);message('');try{await sameUser();await task();}catch(error){if(!disposed)message(error?.message||'Verification could not finish. Please try again.',true);}finally{if(!disposed)controls(false);}}
 function draw(){
  if(disposed)return;
  const factorOptions=verifiedFactors.map(f=>`<option value="${escape(f.id)}">${escape(f.friendly_name||'Authenticator app')}</option>`).join('');
  root.innerHTML=`<div class="owner-mfa"><p class="notice" data-mfa-status role="status" aria-live="polite" hidden></p>${setup?`<ol class="owner-mfa-steps"><li>Open your authenticator app and scan this QR code.</li><li>Save the setup key in your password manager as a backup.</li><li>Enter the six-digit code from your app.</li></ol><img class="owner-mfa-qr" data-mfa-qr alt="Scan this QR code with your authenticator app"><details class="owner-mfa-key"><summary>Show setup key</summary><code data-mfa-key></code><button class="button button-secondary" type="button" data-mfa-copy>Copy setup key</button></details>`:verifiedFactors.length?'<p>Enter the six-digit code from your authenticator app to open your owner tools.</p>':'<p>Add an authenticator app to protect your shop settings, orders and private payment information.</p>'}
  ${setup||verifiedFactors.length?`<form data-mfa-form>${verifiedFactors.length>1?`<label class="field">Authenticator<select name="factor">${factorOptions}</select></label>`:''}<label class="field">Authenticator code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required aria-describedby="owner-mfa-code-help"></label><p class="help-text" id="owner-mfa-code-help">Codes change regularly. Use the code currently shown in your app.</p><button class="button" type="submit">${setup?'Enable protection':'Verify and continue'}</button></form>`:'<button class="button" type="button" data-mfa-enroll>Set up authenticator</button>'}
  ${help}<div class="owner-mfa-actions">${setup?'<button type="button" class="button button-secondary" data-mfa-cancel>Cancel setup</button>':''}<button type="button" class="button button-quiet" data-mfa-signout>Sign out</button></div></div>`;
  if(setup){$('[data-mfa-key]').textContent=setup.secret;const qr=setup.qr_code;$('[data-mfa-qr]').src=qr.startsWith('data:image/svg+xml')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);}
  $('[data-mfa-enroll]')?.addEventListener('click',()=>run(async()=>{
   const marker=epoch;const {data,error}=await auth.mfa.enroll({factorType:'totp',friendlyName:'Elio owner '+crypto.randomUUID().slice(0,8)});
   if(error)throw error;if(disposed||marker!==epoch)return;
   if(!data?.id||!data?.totp?.secret||!data.totp.qr_code)throw Error('Authenticator setup could not start. Please try again.');
   await sameUser();pendingFactor=data.id;setup=data.totp;draw();$('[name=code]').focus();
  }));
  $('[data-mfa-copy]')?.addEventListener('click',()=>run(async()=>{await navigator.clipboard.writeText(setup.secret);message('Setup key copied. Store it securely in your password manager.');}));
  $('[data-mfa-cancel]')?.addEventListener('click',()=>run(async()=>{await cancelPending();draw();$('[data-mfa-enroll]')?.focus();}));
  $('[data-mfa-signout]')?.addEventListener('click',()=>run(async()=>{await cancelPending();const {error}=await auth.signOut({scope:'local'});if(error)throw error;location.reload();}));
  $('[data-mfa-form]')?.addEventListener('submit',event=>{
   event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
   const factorId=pendingFactor||form.elements.factor?.value||verifiedFactors[0]?.id,code=form.elements.code.value;
   void run(async()=>{
    if(!factorId)throw Error('Choose an authenticator to continue.');
    const challenge=await auth.mfa.challenge({factorId});if(challenge.error)throw challenge.error;
    await sameUser();const verify=await auth.mfa.verify({factorId,challengeId:challenge.data.id,code});
    if(verify.error)throw verify.error;
    // Once verified, never treat this factor as a cancellable setup draft.
    pendingFactor=null;setup=null;
    if(!verifiedFactors.some(f=>f.id===factorId))verifiedFactors.push({id:factorId,status:'verified',friendly_name:'Authenticator app'});
    draw();controls(true);await sameUser();const access=await api('account_access');
    if(access?.role!=='owner'||access.mfa_required!==false)throw Error('Your owner session is not ready. Sign in again and verify your code.');
    await sameUser();root.replaceChildren();await onVerified();
   });
  });
 }
 async function cancelPending(){if(pendingFactor){const {error}=await auth.mfa.unenroll({factorId:pendingFactor});if(error)throw error;}pendingFactor=null;setup=null;}
 async function initialize(){
  root.innerHTML='<p class="notice" role="status">Checking your authenticator…</p>';
  try{
   const {data,error}=await auth.getSession();if(error||!data?.session)throw Error('Sign in again to verify your owner account.');ownerId=data.session.user.id;
   const factors=await auth.mfa.listFactors();if(factors.error)throw factors.error;if(disposed)return;
   verifiedFactors=(factors.data?.totp||[]).filter(f=>f.status==='verified');
   if(!verifiedFactors.length&&(factors.data?.all||[]).some(f=>f.status==='verified'))throw Error('This account uses another second-factor method. Ask your project administrator for help signing in.');
   draw();$('[name=code]')?.focus();
  }catch(error){if(!disposed){root.innerHTML='<p class="notice danger" data-mfa-status role="status"></p><button type="button" class="button" data-mfa-retry>Try again</button><button type="button" class="button button-quiet" data-mfa-exit>Sign out</button>'+help;message(error.message,true);$('[data-mfa-retry]').addEventListener('click',()=>void initialize());$('[data-mfa-exit]').addEventListener('click',()=>void run(async()=>{const {error}=await auth.signOut({scope:'local'});if(error)throw error;location.reload();}));}}
 }
 const ready=initialize();
 return {ready,destroy(){disposed=true;epoch++;pendingFactor=null;setup=null;verifiedFactors=[];root.replaceChildren();}};
}
