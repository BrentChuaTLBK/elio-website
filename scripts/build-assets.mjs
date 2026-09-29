import {readFile,writeFile,readdir,mkdir,cp} from 'node:fs/promises';
import {resolve,join,extname,posix} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {initializeImageMagick,ImageMagick,MagickFormat} from '@imagemagick/magick-wasm';
const root=resolve(import.meta.dirname,'..'),source=join(root,'dist'),out=join(root,'.release');
const require=createRequire(import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex').slice(0,20);
await mkdir(out,{recursive:true});await cp(source,out,{recursive:true});await mkdir(join(out,'_immutable'),{recursive:true});
async function walk(dir,prefix=''){const paths=[];for(const f of await readdir(dir,{withFileTypes:true})){if(f.isDirectory())paths.push(...await walk(join(dir,f.name),prefix+f.name+'/'));else paths.push(prefix+f.name);}return paths;}
const files=await walk(source),mapping=new Map(),variants={};
await initializeImageMagick(await readFile(require.resolve('@imagemagick/magick-wasm/magick.wasm')));
const publish=async(bytes,extension)=>{const path=`/_immutable/${hash(bytes)}${extension}`;await writeFile(join(out,path),bytes);return path;};
const makeVariants=async(key,bytes)=>{
 let dimensions;ImageMagick.read(bytes,img=>{dimensions={width:img.width,height:img.height};});
 const rows=[];
 for(const width of [176,264,640,960,1440].filter(w=>w<dimensions.width)){
  let resized;ImageMagick.read(bytes,img=>{img.resize(width,Math.round(dimensions.height*width/dimensions.width));img.quality=88;img.write(MagickFormat.WebP,result=>{resized=Buffer.from(result);});});
  if(resized.length<bytes.length)rows.push({width,url:await publish(resized,'.webp')});
 }
 rows.push({width:dimensions.width,url:await publish(bytes,'.webp')});variants[key]=rows.sort((a,b)=>a.width-b.width);
};
for(const file of files.filter(f=>/\.(webp|png|svg|ttf|woff2?)$/.test(f))){const bytes=await readFile(join(source,file));mapping.set(file,await publish(bytes,extname(file)));if(file.endsWith('.webp'))await makeVariants(file,bytes);}
let remote=[];try{remote=JSON.parse(await readFile(join(root,'scripts/public-image-sources.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const url of remote){
 if(!/^https:\/\/dzxyhckkkrzqpwpavngn\.supabase\.co\/storage\/v1\/object\/public\/product-images\/[a-f0-9-]+\/[a-f0-9-]+\.webp$/.test(url))throw Error('Unexpected public image origin/path');
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Public image download failed: '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>5*1024*1024)throw Error('Product image exceeds build limit');await makeVariants(url,bytes);
}
await writeFile(join(out,'assets/responsive-image-map.js'),`export const imageVariants=${JSON.stringify(variants)};\n`);
function mapped(value,file){if(/^(?:https?:|data:|#|\/\/)/.test(value))return value;const path=posix.normalize(value.startsWith('/')?value.slice(1):posix.join(posix.dirname(file),value.split(/[?#]/)[0]));return mapping.get(path)||value;}
for(const file of files.filter(f=>f.endsWith('.css'))){let css=await readFile(join(source,file),'utf8');css=css.replace(/url\((['"]?)([^)'"\s]+)\1\)/g,(_,quote,url)=>`url("${mapped(url,file)}")`);mapping.set(file,await publish(Buffer.from(css),'.css'));}
for(const file of files.filter(f=>f.endsWith('.html'))){let html=await readFile(join(source,file),'utf8');html=html.replace(/\b(src|href)=(['"])([^'"]+)\2/g,(_,attr,quote,url)=>`${attr}=${quote}${mapped(url,file)}${quote}`);await writeFile(join(out,file),html);}
await writeFile(join(out,'_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy-Report-Only: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://esm.sh https://cdn.jsdelivr.net https://www.googletagmanager.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.supabase.co https://www.google-analytics.com https://www.googletagmanager.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://esm.sh https://cdn.jsdelivr.net https://*.google-analytics.com https://*.analytics.google.com https://cloudflareinsights.com; worker-src 'self' blob:; frame-src https://accounts.google.com; form-action 'self'
/_immutable/*
  Cache-Control: public, max-age=31536000, immutable
/assets/admin/config.js
  Cache-Control: no-store
/assets/responsive-image-map.js
  Cache-Control: no-cache
`);
await mkdir(join(root,'test-results/asset-build'),{recursive:true});await writeFile(join(root,'test-results/asset-build/manifest.json'),JSON.stringify({mapping:Object.fromEntries(mapping),variants},null,2));
console.log(`Built ${mapping.size} versioned media/styles and ${Object.keys(variants).length} responsive photo sets. JavaScript/configuration and all APIs remain fresh.`);
execFileSync(process.execPath,[join(root,'scripts/prepare-launch-seo.mjs'),out],{stdio:'inherit'});
