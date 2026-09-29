export class BackupError extends Error {constructor(public code:string){super(code);}}
export const backupError=(e:unknown)=>e instanceof BackupError?e.code:'network';
