import assert from 'node:assert/strict';
import {buildProduction} from '../dist/assets/admin/production.js';
const fixed={product_id:'set',name:'Signature',quantity:2,selections:{},flavor_contents:[{product_id:'v',name:'Vanilla',quantity:2},{product_id:'m',name:'Matcha',quantity:1}]};
const custom={product_id:'custom',name:'Custom trio',quantity:1,selections:{flavors:{v:3}},flavor_contents:[{product_id:'v',name:'Vanilla',quantity:3}]};
const base={payment_status:'paid',fulfillment_status:'confirmed',fulfillment_date:'2026-10-01',items:[fixed,custom]};
const orders=[base,{...base,fulfillment_date:'2026-10-02',fulfillment_status:'completed',items:[custom]},...['cancelled','expired','refunded','pending_confirmation'].map(fulfillment_status=>({...base,fulfillment_status})),...['awaiting_payment','under_review','rejected'].map(payment_status=>({...base,payment_status})),{...base,refund_label:true},{...base,fulfillment_date:'2026-09-30'}];
const report=buildProduction(orders,'2026-10-01','2026-10-02');
assert.equal(report.orders,2);assert.equal(report.fixed,2);assert.equal(report.custom,2);assert.equal(report.boxes,4);assert.equal(report.pieces,12);assert.equal(report.servedBoxes,1);assert.equal(report.servedPieces,3);
assert.deepEqual(report.flavors.map(f=>[f.name,f.pieces,f.served]),[['Matcha',2,0],['Vanilla',10,3]]);
assert.deepEqual(report.days.map(d=>[d.date,d.boxes,d.pieces]),[['2026-10-01',3,9],['2026-10-02',1,3]]);
assert.equal(buildProduction(orders,'2026-10-02','2026-10-02').pieces,3);
assert.equal(buildProduction([{...base,reference:'ELIO-LEGACY',items:[{...fixed,flavor_contents:undefined}]}],'2026-10-01','2026-10-01').missing[0],'ELIO-LEGACY');
assert.throws(()=>buildProduction(orders,'2026-02-30','2026-10-01'),/valid date range/);
assert.throws(()=>buildProduction(orders,'2026-10-02','2026-10-01'),/valid date range/);
console.log('PASS 13 production totals, saved recipes, served orders, exclusions and range checks');

const vanilla={product_id:'v',name:'Vanilla',quantity:1},gorgonzola={product_id:'g',name:'Gorgonzola',quantity:1};
const customOrder=(recipe,quantity,date='2026-10-01',status='confirmed')=>({...base,fulfillment_date:date,fulfillment_status:status,items:[{...custom,quantity,flavor_contents:recipe}]});
const variants=buildProduction([
 customOrder([vanilla,gorgonzola,vanilla],2),
 customOrder([vanilla,vanilla,gorgonzola],3,'2026-10-02','completed'),
 customOrder([{...vanilla,quantity:2},gorgonzola],1),
 customOrder([vanilla,{...gorgonzola,quantity:2}],4),
],'2026-10-01','2026-10-02');
assert.equal(variants.sets.length,2);
assert.deepEqual(variants.sets.map(s=>[s.combination,s.boxes,s.served]),[['1 × Gorgonzola · 2 × Vanilla',6,3],['2 × Gorgonzola · 1 × Vanilla',4,0]]);
assert.equal(variants.boxes,10);assert.equal(variants.pieces,30);
assert.deepEqual(variants.flavors.map(f=>[f.name,f.pieces]),[['Gorgonzola',14],['Vanilla',16]]);
assert.deepEqual(variants.days[0].sets.map(s=>s.boxes),[3,4]);assert.equal(variants.days[1].sets[0].boxes,3);
console.log('PASS 7 custom combination, repeated flavor, arrangement and daily breakdown checks');
