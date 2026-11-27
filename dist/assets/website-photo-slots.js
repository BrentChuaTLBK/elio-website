// One catalog for the public page bindings and the owner's photo editor.
export const photoPages = [
 {id:'home',name:'Home page',href:'index.html'},
 {id:'story',name:'Our Story',href:'story.html'},
 {id:'shop',name:'Shop',href:'order.html'},
 {id:'flavors',name:'Flavors page',href:'flavors.html'},
];
export const photoSlots = [
 ['home_hero','home','Top banner','home-editorial-hero.webp','A square Basque cheesecake on a ceramic plate','Wide landscape · subject on the right',2.33],
 ['home_box','home','Three-flavor box','trio-story-concept.webp','An open Elio box with three cheesecakes','Wide landscape · leave space on the left',3.2],
 ['home_story','home','Our Story introduction','home-editorial-story.webp','A cheesecake being placed on a plate','Landscape photograph',1.5],
 ['home_gift','home','Gifting banner','home-editorial-gift.webp','An Elio gift box on ivory linen','Wide landscape · subject on the right',2.2],
 ['home_gift_detail','home','Gifting popup','gifting-concept.webp','An Elio bag and cheesecake box','Portrait or landscape photograph',1.4],
 ['story_hero','story','Top banner','home-editorial-story.webp','A cheesecake being placed on a plate','Wide landscape photograph',3.2],
 ['story_plated','story','Photo below Our story','home-editorial-hero.webp','A square Basque cheesecake on a plate','Portrait photograph',.8],
 ['story_kitchen','story','From TLB Kitchen','unboxing-moment-concept.webp','Opening a box of Elio cheesecakes','Square photograph',1],
 ['story_explore','story','Explore the flavors','trio-story-concept.webp','An open box of three Elio cheesecakes','Landscape photograph',2.2],
 ['shop_hero','shop','Top banner','shop-hero-concept.webp','Three individual square Basque cheesecakes','Wide landscape · subject on the right',3],
 ['shop_gift','shop','Gifting banner · desktop','thoughtful-gift-wide-concept.webp','An Elio gift bag and cheesecake box','Wide landscape photograph',3],
 ['shop_gift_mobile','shop','Gifting banner · mobile','thoughtful-gift-concept.webp','An Elio gift bag and cheesecake box','Portrait or square photograph',1],
 ['flavors_hero','flavors','Top banner','home-editorial-hero.webp','A golden square Basque cheesecake','Wide landscape · subject on the right',2.4],
 ['flavors_box','flavors','Find your perfect box','home-editorial-gift.webp','An Elio gift box with gold lettering','Landscape photograph',2.2],
].map(([id,page,name,file,alt,hint,ratio])=>({id,page,name,src:'assets/'+file,alt,hint,ratio}));

export function websitePhotoUrl(path,base) {
 if(typeof path!=='string'||! /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|png|jpe?g|heic|heif)$/.test(path))return '';
 try{const url=new URL(base);if(url.protocol!=='https:')return '';return url.origin+'/storage/v1/object/public/website-images/'+path;}catch{return '';}
}

export const sharePhotoSlots = {
 '/': 'home_hero', '/order': 'shop_hero', '/flavors': 'flavors_hero', '/story': 'story_hero', '/box': 'home_box',
};

export function websiteSharePath(path) {
 return path.replace(/\.[^.]+$/, path.endsWith('.jpg') ? '.jpeg' : '.jpg');
}

export async function readPublishedPhotos(config, {fetcher = fetch, timeout = 5000} = {}) {
 const response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/shop_api`, {
  method:'POST', headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},
  body:JSON.stringify({p_action:'website_photos',p_payload:{},p_token:null}), cache:'no-store', signal:AbortSignal.timeout(timeout),
 });
 if (!response.ok) throw new Error('Website photos unavailable');
 const {photos} = await response.json();
 return publicPhotoRows(photos,config.supabaseUrl);
}

export function publicPhotoRows(photos,base) {
 if (!photos || typeof photos !== 'object' || Array.isArray(photos)) throw new Error('Invalid website photos');
 const result = {};
 const position = value => Number.isInteger(value) && value >= 0 && value <= 100 ? value : 50;
 for (const {id} of photoSlots) {
  const saved = photos[id];
  if (!websitePhotoUrl(saved?.path,base)) continue;
  result[id] = {path:saved.path, alt:String(saved.alt || '').slice(0,240), position_x:position(saved.position_x), position_y:position(saved.position_y)};
 }
 return result;
}
