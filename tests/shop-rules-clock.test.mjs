import assert from 'node:assert/strict';
import {dateInManila,sameDayOpen,customerBookingWindow,earliestLeadDate,availability} from '../dist/assets/shop/shop-rules.js';

const settings={cutoff_time:'09:00',production_weekdays:[0,1,2,3,4,5,6]};
const before=new Date('2026-10-02T00:59:59.999Z'),at=new Date('2026-10-02T01:00:00.000Z');
assert.equal(sameDayOpen(settings,before),true);
assert.equal(sameDayOpen(settings,at),false);
assert.equal(sameDayOpen(settings,new Date(at.getTime()+1)),false);
assert.equal(sameDayOpen({cutoff_time:'15:30:45'},new Date('2026-10-02T07:30:44.999Z')),true);
assert.equal(sameDayOpen({cutoff_time:'15:30:45'},new Date('2026-10-02T07:30:45.000Z')),false);
assert.equal(sameDayOpen({},at),true);
assert.equal(dateInManila('2026-10-01T15:59:59.999Z'),'2026-10-01');
assert.equal(dateInManila('2026-10-01T16:00:00.000Z'),'2026-10-02');
assert.equal(dateInManila('2026-12-31T15:59:59.999Z'),'2026-12-31');
assert.equal(dateInManila('2026-12-31T16:00:00.000Z'),'2027-01-01');
assert.equal(dateInManila('2028-02-28T16:00:00.000Z'),'2028-02-29');
assert.equal(customerBookingWindow(new Date('2028-01-31T15:59:59.999Z')).maxDate,'2028-02-29');
assert.equal(customerBookingWindow(new Date('2028-01-31T16:00:00.000Z')).maxDate,'2028-03-31');
const product={id:'clock-test',kind:'set',active:true,allow_same_day:true,lead_days:0,min_quantity:1,flavor_contents:[{id:'vanilla',active:true,quantity:3}]};
const inventory=[{product_id:'vanilla',date:'2026-10-02',capacity:9,remaining:9}];
assert.equal(earliestLeadDate(product,settings,before),'2026-10-02');
assert.equal(earliestLeadDate(product,settings,at),'2026-10-03');
assert.equal(availability(product,'2026-10-02',settings,inventory,before).available,true);
assert.equal(availability(product,'2026-10-02',settings,inventory,at).available,false);
// Revisit an earlier instant after later checks: only formatters are reused.
assert.equal(sameDayOpen(settings,before),true);
assert.equal(dateInManila('2026-10-01T15:59:59.999Z'),'2026-10-01');
console.log('PASS 19 clock boundary checks: cutoff milliseconds/seconds, Manila midnight, year/leap dates, and fresh availability.');
