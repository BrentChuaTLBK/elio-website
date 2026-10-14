import {inspectImage} from '../image-file.js';
import {activeRecoveryOrders,recoveryEnvelope,validateRecovery} from './recovery-data.js';
import {sha256 as incrementalSha256} from '../vendor/noble-hashes-2.4.0/sha2.js';
import {crc32} from '../vendor/crc-32-1.2.2/crc32.js';
export class BackupError extends Error {constructor(code){super(code);this.code=code;}}
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_PROOF_BYTES = 20 * 1024 * 1024;
export const MAX_RECOVERY_BYTES = 96 * 1024 * 1024;
export const MAX_RECOVERY_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_PROOF_FILES = 20000;
export const MAX_PROOF_PARTS = 16;
const utf8 = new TextEncoder();
export const sha256 = async (bytes)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n)=>n.toString(16).padStart(2, '0')).join('');
export function zipFiles(files, {partsOnly=false, maximum=MAX_ARCHIVE_BYTES,checksum=crc32}={}) {
    let offset = 0;
    const parts = [], directory = [], names = new Set();
    for (const file of files){
        if (!/^[A-Za-z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.includes('..') || names.has(file.name)) throw new BackupError('configuration');
        names.add(file.name);
        const name = utf8.encode(file.name), crc = checksum(file.bytes), local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x800, true);
        view.setUint16(12, 33, true);
        view.setUint32(14, crc, true);
        view.setUint32(18, file.bytes.length, true);
        view.setUint32(22, file.bytes.length, true);
        view.setUint16(26, name.length, true);
        local.set(name, 30);
        const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
        c.setUint32(0, 0x02014b50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x800, true);
        c.setUint16(14, 33, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, file.bytes.length, true);
        c.setUint32(24, file.bytes.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true);
        central.set(name, 46);
        parts.push(local, file.bytes);
        directory.push(central);
        offset += local.length + file.bytes.length;
    }
    const centralSize = directory.reduce((n, b)=>n + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);
    const size = offset + centralSize + 22;
    if (size > maximum || files.length > 65535) throw new BackupError('too_large');
    if (partsOnly) return {parts:[...parts,...directory,end],size};
    const result = new Uint8Array(size);
    let at = 0;
    for (const part of [
        ...parts,
        ...directory,
        end
    ]){
        result.set(part, at);
        at += part.length;
    }
    return result;
}
function validImage(bytes, extension) {
    if (bytes.length < 12 || bytes.length > MAX_PROOF_BYTES) return false;
    if (extension === 'heic' || extension === 'heif') { try { return inspectImage(bytes).mime === 'image/heic'; } catch { return false; } }
    if (extension === 'png') return [
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10
    ].every((v, i)=>bytes[i] === v);
    if (extension === 'webp') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    return bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
}
export async function makeProofArchive(snapshot, download) {
    validateRecovery(snapshot);
    const files = [], manifest = [], seen = new Set();
    let bytesTotal = 0;
    for (const order of activeRecoveryOrders(snapshot)){
        if (order.payment_status === 'under_review' && !order.proof_path) throw new BackupError('proof_files');
        const paths = [
            order.proof_path,
            ...snapshot.payments.filter((p)=>p.order_id === order.id).map((p)=>p.proof_path)
        ].filter(Boolean);
        const reference = /^[A-Za-z0-9-]{1,40}$/.test(order.reference || '') ? order.reference : order.id;
        let number = 0;
        for (const path of paths){
            if (typeof path !== 'string' || !path.startsWith(order.id + '/') || !/^[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,100}\.(png|jpe?g|heic|heif|webp)$/i.test(path)) throw new BackupError('proof_files');
            if (seen.has(path)) continue;
            seen.add(path);
            const bytes = await download(path), extension = path.split('.').at(-1).toLowerCase();
            if (!validImage(bytes, extension)) throw new BackupError('proof_files');
            bytesTotal += bytes.length;
            if (bytesTotal > MAX_ARCHIVE_BYTES - 1024 * 1024) throw new BackupError('too_large');
            const name = `proofs/${reference}/${reference}-payment-proof-${++number}.${extension}`;
            files.push({
                name,
                bytes
            });
            manifest.push({
                order_id: order.id,
                reference: order.reference,
                customer: order.buyer?.name || '',
                fulfillment_date: order.fulfillment_date,
                payment_status: order.payment_status,
                path,
                file: name,
                bytes: bytes.length,
                sha256: await sha256(bytes)
            });
        }
    }
    const backedUp = {
        ...snapshot,
        proof_files: manifest,
        limitations: (snapshot.limitations || []).map((text)=>text === 'Receipt and payout-proof paths are included; the underlying private image files are not bundled.' ? 'Active-order payment-proof images are bundled in this ZIP and listed in proof_files. Affiliate payout-proof images are not bundled.' : text)
    };
    const cell = (v)=>'"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
    const index = [
        [
            'Order reference',
            'Order ID',
            'Customer',
            'Scheduled date',
            'Payment status',
            'Proof file',
            'SHA-256'
        ],
        ...manifest.map((p)=>[
                p.reference,
                p.order_id,
                p.customer,
                p.fulfillment_date,
                p.payment_status,
                p.file,
                p.sha256
            ])
    ].map((row)=>row.map(cell).join(',')).join('\r\n');
    files.unshift({
        name: 'payment-proofs-index.csv',
        bytes: utf8.encode('\uFEFF' + index)
    });
    files.unshift({
        name: 'recovery.json',
        bytes: utf8.encode(JSON.stringify(await recoveryEnvelope(backedUp)))
    }, {
        name: 'README.txt',
        bytes: utf8.encode('Elio order recovery\nGenerated: ' + snapshot.generated_at + '\nContains the selected orders awaiting service, their attached proof files, and the structured recovery snapshot. Under review does not mean payment is confirmed. Proofs are exact private uploaded bytes, not expiring links. Completed orders leave the active archive on the next successful backup. Keep this archive private. Reconcile fulfilled orders and payments before restoring.\n')
    });
    return {
        bytes: zipFiles(files),
        snapshot: backedUp,
        proof_count: manifest.length
    };
}

const digestParts = (parts,hashFactory)=>{
    const hash=hashFactory();
    for(const bytes of parts)hash.update(bytes);
    return Array.from(hash.digest(),n=>n.toString(16).padStart(2,'0')).join('');
};
// A ZIP entry assembled from bounded byte segments. The outer ZIP uses the
// standard data-descriptor flag so no complete archive needs to be buffered.
async function* streamZip(entries, result, maximum,hashFactory,checksum) {
    let offset=0;const directory=[],hash=hashFactory(),names=new Set();
    const emit=(bytes)=>{offset+=bytes.length;if(offset>maximum)throw new BackupError('too_large');hash.update(bytes);return bytes;};
    for await(const file of entries){
        if(!/^[A-Za-z0-9_./-]+$/.test(file.name)||file.name.includes('..')||names.has(file.name))throw new BackupError('configuration');
        names.add(file.name);const name=utf8.encode(file.name),start=offset,local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
        v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x808,true);v.setUint16(12,33,true);v.setUint16(26,name.length,true);local.set(name,30);yield emit(local);
        let crc=0,size=0;
        for(const bytes of file.parts){crc=checksum(bytes,crc);size+=bytes.length;yield emit(bytes);}
        const descriptor=new Uint8Array(16),d=new DataView(descriptor.buffer);
        d.setUint32(0,0x08074b50,true);d.setUint32(4,crc,true);d.setUint32(8,size,true);d.setUint32(12,size,true);yield emit(descriptor);
        const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
        c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x808,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);c.setUint16(28,name.length,true);c.setUint32(42,start,true);central.set(name,46);directory.push(central);
        file.parts=[];
    }
    const centralStart=offset;for(const bytes of directory)yield emit(bytes);
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,directory.length,true);e.setUint16(10,directory.length,true);e.setUint32(12,offset-centralStart,true);e.setUint32(16,centralStart,true);yield emit(end);
    result.bytes=offset;result.sha256=Array.from(hash.digest(),n=>n.toString(16).padStart(2,'0')).join('');
}

export function proofArchiveStream(snapshot,download,{checkpoint=async()=>{},maximum=MAX_RECOVERY_BYTES,hashFactory=()=>incrementalSha256.create(),checksum=crc32}={}) {
    validateRecovery(snapshot);const result={format_version:2,proof_count:0,part_count:0};
    async function* entries(){
        const proofs=[],parts=[],seen=new Set();let files=[],partSize=22,total=0;
        const finishPart=()=>{
            if(parts.length>=MAX_PROOF_PARTS)throw new BackupError('too_large');
            const name=`proof-parts/part-${String(parts.length+1).padStart(4,'0')}.zip`,zip=zipFiles(files,{partsOnly:true,checksum});
            parts.push({file:name,bytes:zip.size,sha256:digestParts(zip.parts,hashFactory),proof_count:files.length});files=[];partSize=22;
            return {name,parts:zip.parts};
        };
        for(const order of activeRecoveryOrders(snapshot)){
            if(order.payment_status==='under_review'&&!order.proof_path)throw new BackupError('proof_files');
            const paths=[order.proof_path,...snapshot.payments.filter(p=>p.order_id===order.id).map(p=>p.proof_path)].filter(Boolean);
            const reference=/^[A-Za-z0-9-]{1,40}$/.test(order.reference||'')?order.reference:order.id;let number=0;
            for(const path of paths){
                if(typeof path!=='string'||!path.startsWith(order.id+'/')||!/^[a-f0-9-]{36}\/[A-Za-z0-9_-]{1,100}\.(png|jpe?g|heic|heif|webp)$/i.test(path))throw new BackupError('proof_files');
                if(seen.has(path))continue;seen.add(path);
                if(seen.size>MAX_PROOF_FILES)throw new BackupError('too_large');
                const extension=path.split('.').at(-1).toLowerCase(),name=`proofs/${reference}/${reference}-payment-proof-${++number}.${extension}`,overhead=76+2*utf8.encode(name).length;
                // Flush before downloading when the largest allowed original
                // could overflow this part. This avoids holding two large
                // originals while an already-full part waits for upload.
                if(files.length&&partSize+MAX_PROOF_BYTES+overhead>MAX_ARCHIVE_BYTES)yield finishPart();
                await checkpoint();const bytes=await download(path);
                if(!validImage(bytes,extension))throw new BackupError('proof_files');
                const cost=bytes.length+overhead;
                total+=cost;if(total>maximum-1024*1024)throw new BackupError('too_large');
                if(files.length&&partSize+cost>MAX_ARCHIVE_BYTES)yield finishPart();
                files.push({name,bytes});partSize+=cost;
                proofs.push({order_id:order.id,reference:order.reference,customer:order.buyer?.name||'',fulfillment_date:order.fulfillment_date,payment_status:order.payment_status,path,file:name,part:`proof-parts/part-${String(parts.length+1).padStart(4,'0')}.zip`,bytes:bytes.length,sha256:digestParts([bytes],hashFactory)});
            }
        }
        if(files.length)yield finishPart();
        result.snapshot={...snapshot,proof_files:proofs,archive_format_version:2,limitations:(snapshot.limitations||[]).map(t=>t==='Receipt and payout-proof paths are included; the underlying private image files are not bundled.'?'Active-order payment-proof images are bundled in the numbered proof ZIP parts. Affiliate payout-proof images are not bundled.':t)};
        result.proof_count=proofs.length;result.part_count=parts.length;
        const recovery=utf8.encode(JSON.stringify(await recoveryEnvelope(result.snapshot)));
        if(recovery.length>MAX_RECOVERY_JSON_BYTES)throw new BackupError('too_large');
        const manifest={source:'elio-proof-archive',format_version:2,generated_at:snapshot.generated_at,proof_count:proofs.length,parts,recovery:{file:'recovery.json',bytes:recovery.length,sha256:await sha256(recovery)}};
        yield {name:'recovery.json',parts:[recovery]};
        yield {name:'manifest.json',parts:[utf8.encode(JSON.stringify(manifest))]};
        const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
        yield {name:'payment-proofs-index.csv',parts:[utf8.encode('\uFEFF'+[['Order reference','Order ID','Proof part','Proof file','SHA-256'],...proofs.map(p=>[p.reference,p.order_id,p.part,p.file,p.sha256])].map(r=>r.map(cell).join(',')).join('\r\n'))]};
        yield {name:'README.txt',parts:[utf8.encode('Elio order recovery archive v2\nExtract this ZIP, then extract the numbered ZIP files in proof-parts. manifest.json verifies each part; recovery.json contains the checksummed order snapshot and original Storage paths. The outer SHA-256 is recorded in the backup sheet. Under review does not mean payment is confirmed. Keep all parts together and private. This is an operational order copy, not a full database backup.\n')]};
    }
    return {stream:streamZip(entries(),result,maximum,hashFactory,checksum),result};
}

export async function makePartitionedProofArchive(snapshot,download,options={}) {
    const archive=proofArchiveStream(snapshot,download,options),parts=[];
    for await(const bytes of archive.stream)parts.push(bytes);
    return {...archive.result,blob:new Blob(parts,{type:'application/zip'})};
}
