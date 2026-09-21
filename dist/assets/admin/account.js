import {auth,ready,initializationError,authLink} from './client.js';
const form=document.querySelector('#account-form'), status=document.querySelector('#account-status');
const heading=document.querySelector('#account-heading'), submit=document.querySelector('#account-submit');
let mode='signin';
const message=(text,error=false)=>{status.textContent=text;status.className=error?'notice danger':'notice';};
function setMode(value){mode=value;heading.textContent={signin:'Sign in to Elio.',signup:'Create your Elio account.',reset:'Reset your password.',recovery:'Choose a new password.'}[value];submit.textContent={signin:'Sign in',signup:'Create account',reset:'Send reset link',recovery:'Save password'}[value];form.email.closest('label').hidden=value==='recovery';form.email.required=value!=='recovery';document.querySelector('#password-field').hidden=value==='reset';form.password.required=value!=='reset';form.password.autocomplete=value==='signin'?'current-password':'new-password';document.querySelector('#account-mode').textContent=value==='signin'?'Create an account':'Back to sign in';}
document.querySelector('#account-mode').addEventListener('click',()=>setMode(mode==='signin'?'signup':'signin'));
document.querySelector('#account-reset').addEventListener('click',()=>setMode('reset'));
document.querySelector('#account-signout').addEventListener('click',async()=>{const {error}=await auth.signOut();if(error){message(error.message,true);return;}location.reload();});
form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;submit.disabled=true;message('Connecting…');try{await ready;if(initializationError)throw initializationError;if(!auth)throw new Error('Elio account service is unavailable.');const email=form.email.value.trim(),password=form.password.value;const redirect=new URL('admin-account.html',location.href).href;let result;
if(mode==='signup'){result=await auth.signUp({email,password,options:{emailRedirectTo:redirect}});if(result.error)throw result.error;message('Check your email to verify your Elio account. If no email arrives, the email service may still need configuration.');}
else if(mode==='reset'){result=await auth.resetPasswordForEmail(email,{redirectTo:redirect});if(result.error)throw result.error;message('If an account exists for that email, a reset link will be sent.');}
else if(mode==='recovery'){result=await auth.updateUser({password});if(result.error)throw result.error;message('Password updated.');location.assign('manage.html');}
else{result=await auth.signInWithPassword({email,password});if(result.error)throw result.error;location.assign('manage.html');}
}catch(error){message(error.message||'Unable to complete the request.',true);}finally{submit.disabled=false;}});
await ready;
if(initializationError)message(initializationError.message,true);
else if(auth){const {data,error}=await auth.getSession();if(error)message(error.message,true);else if(authLink.recovery||authLink.type==='recovery')setMode('recovery');else if(data.session){form.hidden=true;document.querySelector('#signed-in').hidden=false;message(`Signed in as ${data.session.user.email}.`);}}
