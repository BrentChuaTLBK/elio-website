import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';

const root=resolve(import.meta.dirname,'..'),out=join(root,'test-results/public-indexing-fixture');
const pages=[['index.html','/'],['story.html','/story'],['flavors.html','/flavors'],['box.html','/box'],['order.html','/order']];
await mkdir(out,{recursive:true});
await mkdir(join(out,'assets'),{recursive:true});
await writeFile(join(out,'assets/public-indexing.js'),await readFile(join(root,'dist/assets/public-indexing.js')));
for(const [file] of pages)await writeFile(join(out,file),await readFile(join(root,'dist',file)));
const privatePages=['account.html','manage.html','pos.html','newsletter.html'];
for(const file of privatePages)await writeFile(join(out,file),await readFile(join(root,'dist',file)));
const generate=()=>execFileSync(process.execPath,[join(root,'scripts/prepare-launch-seo.mjs'),out],{stdio:'pipe'});
generate();
const first=new Map();
for(const [file,path] of pages){
 const html=await readFile(join(out,file),'utf8');first.set(file,html);
 assert.equal((html.match(/<meta\b[^>]*name="robots"/g)||[]).length,1);
 assert.match(html,/<meta name="robots" content="index, follow">/);
 assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
 assert.ok(html.includes(`rel="canonical" href="https://eliocheesecakes.com${path}"`));
 assert.ok(html.indexOf('id="elio-private-indexing"')<html.indexOf('</head>'));
 assert.ok(html.indexOf('<meta charset=')<1024);
}
generate();
for(const [file] of pages)assert.equal(await readFile(join(out,file),'utf8'),first.get(file),'SEO generation must be idempotent: '+file);
for(const file of privatePages){
 const original=await readFile(join(root,'dist',file),'utf8');
 assert.equal(await readFile(join(out,file),'utf8'),original);
 assert.match(original,/<meta[^>]+name="robots"[^>]+content="noindex,\s*nofollow"/);
}
const sitemap=await readFile(join(out,'sitemap.xml'),'utf8');
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]),pages.map(([,path])=>'https://eliocheesecakes.com'+path));
const source=await readFile(join(root,'dist/assets/public-indexing.js'),'utf8');
function visit(path){
 const meta={name:'robots',content:'index, follow'},events=new Map(),location={href:'https://eliocheesecakes.com'+path};
 vm.runInNewContext(source,{URL,Set,location,document:{querySelector:()=>meta},addEventListener:(name,fn)=>events.set(name,fn)});
 return {meta,events,location};
}
for(const path of ['/','/story','/flavors#vanilla','/box','/order?product=tea&collection=classic&utm_source=instagram#your-bag'])assert.equal(visit(path).meta.content,'index, follow',path);
for(const path of ['/order#order=test-order&token=example-only','/order?token=example-only','/order?order=test-order','/order#access_token=example-only','/?code=example-only','/order?unknown=private','/order#%6Frder=test-order'])assert.equal(visit(path).meta.content,'noindex, nofollow',path);
for(const event of ['hashchange','popstate']){
 const view=visit('/order');view.location.href='https://eliocheesecakes.com/order#order=example-only';view.events.get(event)();assert.equal(view.meta.content,'noindex, nofollow');
 view.location.href='https://eliocheesecakes.com/order';view.events.get(event)();assert.equal(view.meta.content,'noindex, nofollow','Privacy must survive token cleanup in the same document');
}
const checkout=visit('/order');checkout.events.get('elio-private-order')();assert.equal(checkout.meta.content,'noindex, nofollow');
console.log('PASS public SEO allowlist, canonical/sitemap metadata, idempotence, private page preservation and 17 public/private navigation cases.');
