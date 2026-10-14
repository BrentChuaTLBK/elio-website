// Reproduce the audited incremental SHA-256 dependency without runtime CDN code.
// Pin package bytes as well as the version; do not silently follow latest.
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const version='2.4.0';
const url=`https://registry.npmjs.org/@noble/hashes/-/hashes-${version}.tgz`;
const integrity='sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==';
const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Pinned hash dependency unavailable.');
const compressed=Buffer.from(await response.arrayBuffer());
if('sha512-'+createHash('sha512').update(compressed).digest('base64')!==integrity)throw Error('Pinned hash dependency integrity mismatch.');
const tar=gunzipSync(compressed,{maxOutputLength:2*1024*1024}),wanted=new Set(['sha2.js','_md.js','_u64.js','utils.js','LICENSE']),files=new Map();
for(let position=0;position+512<=tar.length;){
  const name=tar.subarray(position,position+100).toString('utf8').replace(/\0.*$/s,''),size=parseInt(tar.subarray(position+124,position+136).toString('ascii').replace(/\0.*$/s,'').trim()||'0',8);
  if(!name)break;if(!Number.isSafeInteger(size)||size<0||position+512+size>tar.length)throw Error('Invalid dependency archive.');
  const leaf=name.replace(/^package\//,'');
  if(wanted.has(leaf))files.set(leaf,tar.subarray(position+512,position+512+size));
  position+=512+Math.ceil(size/512)*512;
}
if(files.size!==wanted.size)throw Error('Pinned dependency layout changed.');
for(const [name,bytes]of files)if(name.endsWith('.js'))for(const match of bytes.toString('utf8').matchAll(/from ['"]\.\/([^'"]+)['"]/g))if(!wanted.has(match[1]))throw Error('Unexpected hash dependency: '+match[1]);
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../dist/assets/vendor/noble-hashes-'+version);
await mkdir(directory,{recursive:true});
const manifest={package:'@noble/hashes',version,license:'MIT',source:url,integrity,files:[]};
for(const [name,bytes]of files){await writeFile(join(directory,name),bytes);manifest.files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(join(directory,'provenance.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version,files:files.size,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));

// The hosted Deno compatibility baseline has had native zlib CRC regressions.
// Keep a tested slicing-by-16 CRC implementation with the same browser/server
// result. Its only adaptation is an ES-module export appended below.
const crcUrl='https://registry.npmjs.org/crc-32/-/crc-32-1.2.2.tgz',crcIntegrity='sha512-ROmzCKrTnOwybPcJApAA6WBWij23HVfGVNKqqrZpuyZOHqK2CwHSvpGuyt/UNNvaIjEd8X5IFGp4Mh+Ie1IHJQ==';
const crcResponse=await fetch(crcUrl,{signal:AbortSignal.timeout(30000)});if(!crcResponse.ok)throw Error('Pinned CRC dependency unavailable.');
const crcCompressed=Buffer.from(await crcResponse.arrayBuffer());if('sha512-'+createHash('sha512').update(crcCompressed).digest('base64')!==crcIntegrity)throw Error('Pinned CRC integrity mismatch.');
const crcTar=gunzipSync(crcCompressed,{maxOutputLength:1024*1024}),crcFiles=new Map();
for(let at=0;at+512<=crcTar.length;){const name=crcTar.subarray(at,at+100).toString('utf8').replace(/\0.*$/s,''),size=parseInt(crcTar.subarray(at+124,at+136).toString('ascii').replace(/\0.*$/s,'').trim()||'0',8);if(!name)break;if(!Number.isSafeInteger(size)||size<0||at+512+size>crcTar.length)throw Error('Invalid CRC dependency archive.');if(['package/crc32.js','package/LICENSE'].includes(name))crcFiles.set(name.slice(8),crcTar.subarray(at+512,at+512+size));at+=512+Math.ceil(size/512)*512;}
if(crcFiles.size!==2)throw Error('Pinned CRC dependency layout changed.');
crcFiles.set('crc32.js',Buffer.concat([Buffer.from('// Elio adaptation: keep the upstream factory local to this ES module.\nconst DO_NOT_EXPORT_CRC=true;\n'),crcFiles.get('crc32.js'),Buffer.from('\n// Elio adaptation: expose the existing byte-buffer function as an ES module.\nexport const crc32=(bytes,seed=0)=>CRC32.buf(bytes,seed)>>>0;\n')]));
const crcDirectory=resolve(directory,'../crc-32-1.2.2');await mkdir(crcDirectory,{recursive:true});
const crcManifest={package:'crc-32',version:'1.2.2',license:'Apache-2.0',source:crcUrl,integrity:crcIntegrity,adaptation:'Selected the local factory branch and appended an ES-module crc32 export; upstream algorithm unchanged.',files:[]};
for(const [name,bytes]of crcFiles){await writeFile(join(crcDirectory,name),bytes);crcManifest.files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(join(crcDirectory,'provenance.json'),JSON.stringify(crcManifest,null,2)+'\n');console.log(JSON.stringify({version:'1.2.2',files:crcFiles.size,bytes:crcManifest.files.reduce((n,f)=>n+f.bytes,0)}));
