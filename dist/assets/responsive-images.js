import {imageVariants} from './responsive-image-map.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function responsiveImage(url,sizes='(max-width: 700px) calc(100vw - 48px), 352px'){
 if(typeof url!=='string')return '';
 const local=url.replace(/^\//,'');
 const variants=imageVariants[url]||imageVariants[local];
 if(!variants?.length)return '';
 return `srcset="${esc(variants.map(v=>`${v.url} ${v.width}w`).join(', '))}" sizes="${esc(sizes)}" decoding="async"`;
}
