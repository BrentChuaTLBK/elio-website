import {inspectImage} from '../image-file.js';
import {activeRecoveryOrders,recoveryEnvelope,validateRecovery} from './recovery-data.js';
export class BackupError extends Error {constructor(code){super(code);this.code=code;}}
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_PROOF_BYTES = 20 * 1024 * 1024, utf8 = new TextEncoder();
export const sha256 = async (bytes)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n)=>n.toString(16).padStart(2, '0')).join('');
const crcTable = Array.from({
    length: 256
}, (_, n)=>{
    for(let k = 0; k < 8; k++)n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;
    return n >>> 0;
});
const crc32 = (bytes)=>{
    let n = 0xffffffff;
    for (const b of bytes)n = crcTable[(n ^ b) & 255] ^ n >>> 8;
    return (n ^ 0xffffffff) >>> 0;
};
export function zipFiles(files) {
    let offset = 0;
    const parts = [], directory = [], names = new Set();
    for (const file of files){
        if (!/^[A-Za-z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.includes('..') || names.has(file.name)) throw new BackupError('configuration');
        names.add(file.name);
        const name = utf8.encode(file.name), crc = crc32(file.bytes), local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
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
    if (size > MAX_ARCHIVE_BYTES || files.length > 65535) throw new BackupError('too_large');
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
