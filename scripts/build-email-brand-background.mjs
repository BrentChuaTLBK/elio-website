// A small opaque brand-color tile protects header padding when a mail client
// rewrites HTML colors. It complements, rather than replaces, the logo image.
import {writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
const chunk=(type,data)=>{const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);};
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
const pixels=Buffer.from([0,61,37,28,61,37,28,0,61,37,28,61,37,28]);
await writeFile(new URL('../dist/assets/email-brand-brown-v1.png',import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
console.log('Built opaque dark-brown email background tile.');
