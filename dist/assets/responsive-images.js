import {imageVariants} from './responsive-image-map.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function responsiveImageProps(url,sizes='(max-width: 700px) calc(100vw - 48px), 352px'){
 if(typeof url!=='string')return {};
 const local=url.replace(/^\//,'');
 const variants=imageVariants[url]||imageVariants[local];
 return variants?.length ? {srcSet:variants.map(v=>`${v.url} ${v.width}w`).join(', '),sizes} : {};
}
export function responsiveImage(url,sizes){
 const image=responsiveImageProps(url,sizes);
 return image.srcSet ? `srcset="${esc(image.srcSet)}" sizes="${esc(image.sizes)}" decoding="async"` : '';
}
