// Shared, bounded checks for originals retained when a browser cannot encode WebP.
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const bad = () => { throw new Error('Choose a valid PNG, JPEG, HEIC/HEIF, or WebP image.'); };
const crcTable = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes,start,end){let n=0xffffffff;for(let i=start;i<end;i++)n=crcTable[(n^bytes[i])&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export function inspectImage(bytes) {
 if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new Error('Each photo must be 20 MB or smaller.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(a,b)=>String.fromCharCode(...bytes.subarray(a,b));
 const dimensions=(width,height)=>{if(!width||!height||width*height>60000000)throw new Error('Choose a photo with no more than 60 megapixels.');return {width,height};};
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&text(12,16)==='IHDR'){
  if(view.getUint32(8)!==13)bad();const size=dimensions(view.getUint32(16),view.getUint32(20));let offset=8,pixels=false;
  while(offset+12<=bytes.length){const length=view.getUint32(offset),type=text(offset+4,offset+8),end=offset+12+length;if(end>bytes.length)bad();if(crc(bytes,offset+4,end-4)!==view.getUint32(end-4))bad();if(type==='IDAT'&&length)pixels=true;offset=end;if(type==='IEND'){if(length||!pixels||offset!==bytes.length)bad();return {mime:'image/png',extension:'png',...size};}}
  bad();
 }
 if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217){
  let offset=2,size;
  while(offset+4<=bytes.length){if(bytes[offset++]!==255)bad();while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217||marker===0)bad();if(marker===1||marker>=208&&marker<=215)continue;const length=view.getUint16(offset);if(length<2||offset+length>bytes.length-2)bad();if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)bad();size=dimensions(view.getUint16(offset+5),view.getUint16(offset+3));}if(marker===218){if(!size||length<6||offset+length>=bytes.length-2)bad();return {mime:'image/jpeg',extension:'jpg',...size};}offset+=length;}
  bad();
 }
 if(bytes.length>=20&&text(0,4)==='RIFF'&&text(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(text(12,16))){if(view.getUint32(4,true)+8!==bytes.length||!view.getUint32(16,true)||view.getUint32(16,true)+20>bytes.length)bad();return {mime:'image/webp',extension:'webp'};}
 if(bytes.length>=32&&text(4,8)==='ftyp'){
  // HEIC is an ISO BMFF container. Require complete boxes, HEVC brands, image
  // metadata, dimensions and nonempty media, rather than trusting a filename.
  const boxes=(start,end)=>{const result=[];let at=start;while(at<end){if(at+8>end)bad();let length=view.getUint32(at),header=8;if(length===1){if(at+16>end||view.getUint32(at+8)!==0)bad();length=view.getUint32(at+12);header=16;}else if(length===0)length=end-at;if(length<header||at+length>end)bad();result.push({type:text(at+4,at+8),start:at+header,end:at+length});at+=length;}return result;};
  const top=boxes(0,bytes.length),ftyp=top[0];if(ftyp.type!=='ftyp'||ftyp.end-ftyp.start<12||(ftyp.end-ftyp.start)%4)bad();
  const brands=[text(ftyp.start,ftyp.start+4)];for(let i=ftyp.start+8;i<ftyp.end;i+=4)brands.push(text(i,i+4));
  if(!brands.some(b=>['heic','heix','hevc','hevx','heim','heis','hevm','hevs'].includes(b))||brands.some(b=>['avif','avis'].includes(b)))bad();
  const meta=top.find(b=>b.type==='meta');if(!meta||meta.end-meta.start<4)bad();const children=boxes(meta.start+4,meta.end);
  if(!['hdlr','pitm','iloc','iinf','iprp'].every(type=>children.some(b=>b.type===type&&b.end>b.start)))bad();
  const iprp=children.find(b=>b.type==='iprp'),properties=boxes(iprp.start,iprp.end),ipco=properties.find(b=>b.type==='ipco');if(!ipco)bad();
  const configs=boxes(ipco.start,ipco.end),sizes=configs.filter(b=>b.type==='ispe');if(!configs.some(b=>b.type==='hvcC'&&b.end-b.start>=23)||!sizes.length)bad();
  let size;for(const b of sizes){if(b.end-b.start!==12)bad();const current=dimensions(view.getUint32(b.start+4),view.getUint32(b.start+8));if(!size||current.width*current.height>size.width*size.height)size=current;}
  if(!top.some(b=>b.type==='mdat'&&b.end-b.start>4)&&!children.some(b=>b.type==='idat'&&b.end-b.start>4))bad();
  return {mime:'image/heic',extension:'heic',...size};
 }
 bad();
}
export const photoExtension = file => ({'image/jpeg':'jpg','image/png':'png','image/heic':'heic','image/heif':'heif','image/webp':'webp'}[file.type] || '');
