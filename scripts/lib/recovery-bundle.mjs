import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function containedFile(directory,path){
 if(typeof path!=='string'||!path||path.includes('\\')||path.includes(':')||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Unsafe recovery file path');
 const root=resolve(directory),file=resolve(root,path);
 if(!file.startsWith(root+sep))throw new Error('Recovery file leaves destination');
 return file;
}
export async function writeRecoveryBundle(directory,{database,objects,buckets,metadata}){
 await mkdir(directory,{recursive:true});
 const files=[{path:'database.tgz',kind:'database',bytes:database},...objects.map(object=>({path:'storage/'+object.bucket+'/'+object.name,kind:'storage',bucket:object.bucket,name:object.name,mimetype:object.mimetype,bytes:object.bytes}))];
 const seen=new Set(),manifest={format:'elio-isolated-recovery-v1',createdAt:new Date().toISOString(),scope:'Synthetic local application database and independently copied Storage bytes. Not a hosted production backup.',metadata,buckets,files:[]};
 for(const file of files){
  if(seen.has(file.path))throw new Error('Duplicate recovery file');seen.add(file.path);
  const output=containedFile(directory,file.path);await mkdir(dirname(output),{recursive:true});await writeFile(output,file.bytes,{flag:'wx'});
  const {bytes,...info}=file;manifest.files.push({...info,size:bytes.length,sha256:sha256(bytes)});
 }
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(join(directory,'manifest.json'),manifestBytes,{flag:'wx'});
 return {manifest,manifestSha256:sha256(manifestBytes)};
}
export async function readRecoveryBundle(directory,expectedManifestSha256){
 const bytes=await readFile(join(directory,'manifest.json'));
 if(!/^[a-f0-9]{64}$/.test(expectedManifestSha256)||sha256(bytes)!==expectedManifestSha256)throw new Error('Recovery manifest checksum mismatch');
 const manifest=JSON.parse(bytes.toString('utf8'));
 if(manifest.format!=='elio-isolated-recovery-v1'||!Array.isArray(manifest.files))throw new Error('Unsupported recovery bundle');
 const files=[],seen=new Set();
 for(const file of manifest.files){
  if(seen.has(file.path))throw new Error('Duplicate recovery file');seen.add(file.path);
  const input=containedFile(directory,file.path),data=await readFile(input);
  if(data.length!==file.size||sha256(data)!==file.sha256)throw new Error('Recovery file checksum mismatch: '+file.path);
  files.push({...file,bytes:data});
 }
 const database=files.filter(file=>file.kind==='database');
 if(database.length!==1||database[0].path!=='database.tgz'||files.some(file=>!['database','storage'].includes(file.kind)))throw new Error('Incomplete recovery bundle');
 return {manifest,database:database[0].bytes,objects:files.filter(file=>file.kind==='storage')};
}
export async function restoreStorageFiles(directory,objects){
 // Call only after readRecoveryBundle verifies every file. This deliberately
 // writes a fresh local destination, never a live Supabase bucket.
 for(const object of objects){const file=containedFile(directory,object.bucket+'/'+object.name);await mkdir(dirname(file),{recursive:true});await writeFile(file,object.bytes,{flag:'wx'});}
}
