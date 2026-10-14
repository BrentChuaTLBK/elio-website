import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const dir=resolve(process.argv[2]||'.release'),origin='https://eliocheesecakes.com';
// Public launch was approved on 2026-10-03. Keep the allowlist explicit so
// account, staff, newsletter preference and other private pages stay noindex.
const pages=[['index.html','/'],['story.html','/story'],['flavors.html','/flavors'],['box.html','/box'],['order.html','/order']];
const indexingSource=(await readFile(join(dir,'assets/public-indexing.js'),'utf8')).trim().replace(/<\/script/gi,'<\\/script');
for(const [file,path] of pages){let html=await readFile(join(dir,file),'utf8');
 html=html.replace(/<meta\b[^>]*name=["']robots["'][^>]*>\s*/gi,'');
 html=html.replace(/<script\b[^>]*src=["'](?:\.\/)?assets\/public-indexing\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*/gi,'');
 html=html.replace(/<script\b[^>]*id=["']elio-private-indexing["'][^>]*>[\s\S]*?<\/script>\s*/gi,'');
 const charset=html.match(/<meta\s+charset=[^>]+>/i)?.[0];
 if(!charset)throw new Error(`Missing character encoding in ${file}`);
 html=html.replace(/<meta\s+charset=[^>]+>\s*/i,'');
 // Inline the shared guard to avoid a blocking network request and apply
 // private-link noindex before customer modules can fetch or display data.
 html=html.replace(/<head>/i,`<head>\n  ${charset}\n  <meta name="robots" content="index, follow">\n  <script id="elio-private-indexing">${indexingSource}</script>`);
 html=html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi,'');
 html=html.replace(/<script\b[^>]*id=["']elio-organization-schema["'][^>]*>[\s\S]*?<\/script>\s*/gi,'');
 const canonical=`<link rel="canonical" href="${origin}${path}">`;
 html=html.replace('</head>',`${canonical}\n${file==='index.html'?'<script id="elio-organization-schema" type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'Organization',name:'Elio Basque Cheesecake',url:origin})+'</script>\n':''}</head>`);
 await writeFile(join(dir,file),html);
}
await writeFile(join(dir,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(([,path])=>`<url><loc>${origin}${path}</loc></url>`).join('')+'</urlset>\n');
await writeFile(join(dir,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /manage\nDisallow: /account\nDisallow: /pos\nDisallow: /api/\nDisallow: /assets/admin/order-print\nSitemap: ${origin}/sitemap.xml\n`);
console.log('Enabled indexing for five public pages; prepared canonical metadata and sitemap. Private pages remain noindex.');
