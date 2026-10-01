import { HttpError } from './http.ts';
import { validatePixels } from './image-codec.ts';
import { inspectImage, MAX_IMAGE_BYTES } from '../../../dist/assets/image-file.js';
export { MAX_IMAGE_BYTES };
function inspect(bytes:Uint8Array) {
 if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new HttpError(413,'Choose an image of 20 MB or smaller.');
 try {return inspectImage(bytes);}catch(error){throw new HttpError(415,(error as Error).message);}
}
export function imageType(bytes:Uint8Array):{mime:string;extension:string} {
 const {mime,extension}=inspect(bytes);return {mime,extension};
}
export async function validateImage(bytes:Uint8Array):Promise<{mime:string;extension:string}> {
 const image=inspect(bytes);
 // Originals may need a codec or more pixel memory than this edge runtime has.
 // Structural checks include PNG CRCs, JPEG frames, bounded HEIC boxes and a
 // 60 MP cap. Retain large originals/HEIC without allocating decoded pixels.
 if(image.mime!=='image/heic'&&(!image.width||image.width*image.height<=12000000)){
  try{await validatePixels(bytes,image.mime);}catch(error){
   if(!(error instanceof HttpError)||error.status!==503||image.mime==='image/webp')throw error;
  }
 }
 return {mime:image.mime,extension:image.extension};
}
