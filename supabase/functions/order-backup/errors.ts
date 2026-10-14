import {BackupError} from '../../../dist/assets/admin/proof-archive.js';
export {BackupError} from '../../../dist/assets/admin/proof-archive.js';
export const backupError=(e:unknown)=>e instanceof BackupError?e.code:'network';
export function googleError(status:number,data:any){
 const reasons=[...(data?.error?.details||[]),...(data?.error?.errors||[])].map(d=>String(d.reason||''));
 if(reasons.some(r=>['SERVICE_DISABLED','accessNotConfigured'].includes(r)))return 'api_disabled';
 if(status===429||reasons.some(r=>/quota|rateLimit|dailyLimit|pinnedRevision/i.test(r)))return 'quota';
 return [401,403,404].includes(status)?'access':'network';
}
