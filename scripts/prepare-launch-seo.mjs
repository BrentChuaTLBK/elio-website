import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const dir=resolve(process.argv[2]||'.release'),origin='https://eliocheesecakes.com';
// Launch is a separate owner decision. This script deliberately never removes
// robots noindex. Public metadata can be reviewed before that launch change.
const pages=[['index.html','/'],['story.html','/story'],['flavors.html','/flavors'],['box.html','/box']];
for(const [file,path] of pages){let html=await readFile(join(dir,file),'utf8');
 html=html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi,'');
 html=html.replace(/<script\b[^>]*id=["']elio-organization-schema["'][^>]*>[\s\S]*?<\/script>\s*/gi,'');
 const canonical=`<link rel="canonical" href="${origin}${path}">`;
 html=html.replace('</head>',`${canonical}\n${file==='index.html'?'<script id="elio-organization-schema" type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Organization',name:'Elio Basque Cheesecake',url:origin})+'</script>\n':''}</head>`);
 await writeFile(join(dir,file),html);
}
await writeFile(join(dir,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(([,path])=>`<url><loc>${origin}${path}</loc></url>`).join('')+'</urlset>\n');
await writeFile(join(dir,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /manage\nDisallow: /account\nDisallow: /pos\nDisallow: /assets/admin/order-print\n# Prelaunch HTML remains noindex. Public launch requires an explicit change.\nSitemap: ${origin}/sitemap.xml\n`);
console.log('Prepared public canonical metadata and sitemap; prelaunch noindex remains unchanged.');
