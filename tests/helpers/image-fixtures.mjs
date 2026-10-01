// A minimal HEIC container for structural-validation tests (not a pixel fixture).
export function heicContainer(){
 const box=(name,...parts)=>{const payload=Buffer.concat(parts),head=Buffer.alloc(8);head.writeUInt32BE(payload.length+8);head.write(name,4);return Buffer.concat([head,payload]);};
 const ispe=Buffer.alloc(12);ispe.writeUInt32BE(64,4);ispe.writeUInt32BE(64,8);
 return Buffer.concat([box('ftyp',Buffer.from('heic'),Buffer.alloc(4),Buffer.from('mif1heic')),box('meta',Buffer.alloc(4),box('hdlr',Buffer.alloc(12)),box('pitm',Buffer.alloc(6)),box('iloc',Buffer.alloc(8)),box('iinf',Buffer.alloc(6)),box('iprp',box('ipco',box('hvcC',Buffer.alloc(23)),box('ispe',ispe)))),box('mdat',Buffer.from([0,0,0,4,1,2,3,4]))]);
}
