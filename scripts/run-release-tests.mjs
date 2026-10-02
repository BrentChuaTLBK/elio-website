import {readdir,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const env={...process.env,PLAYWRIGHT_PACKAGE_ROOT:process.env.PLAYWRIGHT_PACKAGE_ROOT||join(root,'node_modules'),PGLITE_PACKAGE_ROOT:process.env.PGLITE_PACKAGE_ROOT||join(root,'tests/backend')};
env.EXCELJS_TEST_PATH=process.env.EXCELJS_TEST_PATH||join(root,'node_modules/exceljs/dist/exceljs.min.js');
const out=join(root,'test-results/release');await mkdir(out,{recursive:true});
const ui=['shop-loading','flavor-loading','flavor-list','flavor-carousel','checkout','customer-friction','customer-recovery','customer-navigation','checkout-admin-progress','order-dashboard','backup-and-edit','account-and-conversions','vouchers','voucher-density','pos-feedback','product-duplicate','upload-fallback','website-photos','payment-options','receipt-progress','order-calendar','maintenance-admin-status','maintenance-and-print','slip-sizing','accounting','affiliates','marketing-insights','site-analytics'];
const suites=['scripts/check.mjs','tests/backend/run.mjs',...(await readdir(join(root,'tests'))).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/'+n),...ui.map(n=>'tests/ui/'+n+'.mjs')];
const results=[];
for(const file of suites){
 console.log('RUN '+file);const start=Date.now();let output='';
 const exit=await new Promise((done,reject)=>{const child=spawn(process.execPath,['--experimental-transform-types',file],{cwd:root,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.once('error',reject);child.once('close',done);});
 await writeFile(join(out,file.replaceAll('/','_')+'.log'),output);results.push({file,exit,ms:Date.now()-start});await writeFile(join(out,'report.json'),JSON.stringify(results,null,2));
 if(exit){console.error(output.slice(-3500));process.exitCode=1;break;}console.log('PASS '+file);
}
// This list uses isolated PGlite fixtures and browser request interception.
// Production audit scripts under work/ are deliberately never included.
