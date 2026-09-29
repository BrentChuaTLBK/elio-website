import {BackupError} from '../../../dist/assets/admin/proof-archive.js';
export {BackupError} from '../../../dist/assets/admin/proof-archive.js';
export const backupError=(e:unknown)=>e instanceof BackupError?e.code:'network';
