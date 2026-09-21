import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function scan(dir){const found=[];for(const file of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+file.name;if(file.isDirectory())found.push(...await scan(p));else if(/\.(m?js)$/.test(p))found.push(p);}return found;}
const files=[...await scan('dist'),'server.mjs'];
for(const path of files){const r=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(1);}}
console.log(`Syntax checked ${files.length} JavaScript files.`);
