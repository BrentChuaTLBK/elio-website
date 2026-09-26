import {writeFile} from 'node:fs/promises';
import {emailFrame,emailIntro,emailButton,escapeEmail as e} from '../supabase/functions/_shared/email-design.ts';

// These files customize presentation only. They do not enable any Auth features
// or security notifications, and hosted templates must be saved separately.
const templates = [
 ['confirmation','Confirm sign up','Confirm your Elio account','Make yourself at home.','Confirm your email address to finish creating your Elio account.','Confirm my email','If you didn’t create an Elio account, you can safely ignore this email.'],
 ['recovery','Reset password','Reset your Elio password','A fresh start.','We received a request to reset your Elio password. Follow the link below to choose a new password.','Reset my password','If you didn’t request this, you can safely ignore this email. Your password will stay the same.'],
 ['magic_link','Magic link','Your Elio sign-in link','Welcome back.','Use the secure link below to sign in to your Elio account.','Sign in to Elio','If you didn’t request this link, you can safely ignore this email.'],
 ['invite','Invite user','You’re invited to Elio','You’re invited.','You’ve been invited to create an Elio account. Follow the link below to get started.','Accept invitation','If you weren’t expecting this invitation, you can ignore it or contact us.'],
 ['email_change','Change email address','Confirm your Elio email change','Confirm your email change.','We received a request to change the email address on your Elio account. Confirm the change using the link below.','Confirm email change','If you didn’t request this change, do not confirm it. Contact us for help.'],
 ['reauthentication','Reauthentication','Your Elio verification code','One more step.','Enter this verification code in your Elio account to continue.','','If you didn’t request this code, do not share it. You can safely ignore this email.'],
 ['password_changed_notification','Password changed','Your Elio password was changed','Your password was changed.','The password for your Elio account was recently changed.','','If you didn’t make this change, reset your password from the account page and contact us immediately.'],
 ['email_changed_notification','Email address changed','Your Elio email address was changed','Your email address was changed.','The email address for your Elio account was recently changed.','','If you didn’t make this change, contact us immediately.'],
 ['phone_changed_notification','Phone number changed','Your Elio phone number was changed','Your phone number was changed.','The phone number for your Elio account was recently changed.','','If you didn’t make this change, contact us immediately.'],
 ['identity_linked_notification','Sign-in method linked','A sign-in method was linked to Elio','A sign-in method was linked.','A sign-in method was linked to your Elio account.','','If you didn’t make this change, contact us immediately.'],
 ['identity_unlinked_notification','Sign-in method removed','A sign-in method was removed from Elio','A sign-in method was removed.','A sign-in method was removed from your Elio account.','','If you didn’t make this change, contact us immediately.'],
 ['mfa_factor_enrolled_notification','Verification method added','A verification method was added to Elio','A verification method was added.','A verification method was added to your Elio account.','','If you didn’t make this change, contact us immediately.'],
 ['mfa_factor_unenrolled_notification','Verification method removed','A verification method was removed from Elio','A verification method was removed.','A verification method was removed from your Elio account.','','If you didn’t make this change, contact us immediately.'],
];
const manifest=[];
for(const [key,label,subject,heading,message,button,note] of templates){
 let body=emailIntro('Your Elio account',heading,message);
 if(button)body+=emailButton(button,'{{ .ConfirmationURL }}')+'<p style="margin:0 0 24px;text-align:left;font-size:12px;line-height:1.7;color:#786858">Button not working? <a href="{{ .ConfirmationURL }}" style="color:#63412d;text-decoration:underline">Use this secure link.</a></p>';
 if(key==='reauthentication')body+='<p style="margin:0 0 24px;padding:20px;text-align:center;background:#f4ecdf;font:bold 32px/1.5 Arial,sans-serif;letter-spacing:6px;color:#63412d">{{ .Token }}</p>';
 body+=`<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #dfd1bd;font:13px/1.8 Arial,sans-serif;color:#786858">${e(note)}</p>`;
 await writeFile(new URL(`../supabase/templates/${key}.html`,import.meta.url),emailFrame(subject,message,body)+'\n');
 manifest.push({key,label,subject,file:`${key}.html`});
}
await writeFile(new URL('../supabase/templates/manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(`Built ${manifest.length} account templates. Hosted Auth configuration was not changed.`);
