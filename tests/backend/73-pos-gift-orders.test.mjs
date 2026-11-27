import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({state,check}) {
  const h=state.h,{api,ids,scalar}=h,{product,date}=await accountingFixture(h),today=await h.day(0);
  const line={...h.item(product),source:'website'};
  const base={order_source:'direct',method:'delivery',fulfillment_date:date,delivery_cents:3000,items:[line],buyer:{name:'Local gift fixture'}};
  const quote=(payload,actor=ids.staff)=>api('pos_quote',payload,actor);
  const create=async payload=>{
    const request={...payload,expected_quote:await quote(payload),idempotency_key:randomUUID()};
    const result=await api('pos_create_order',request,ids.staff);
    assert.equal((await api('pos_create_order',request,ids.staff)).id,result.id);
    return result;
  };
  const payments=order=>scalar('select count(*)::int from elio.payments where order_id=$1',[order.id]);
  const ledger=order=>scalar('select count(*)::int from elio.accounting_ledger where order_id=$1',[order.id]);
  const reportRows=order=>scalar('select count(*)::int from elio.accounting_rows_v2($1,$1) where order_id=$2',[today,order.id]);
  const preview=(order,changes)=>api('preview_edit_order',{order_id:order.id,revision:order.revision,changes},ids.staff);
  const edit=async(order,changes)=>{
    const q=await preview(order,changes);
    const expected=Object.fromEntries(['items','subtotal_cents','discount_cents','delivery_cents','total_cents','gift'].map(field=>[field,q[field]]));
    return h.action('edit_order',order,{changes,expected_quote:expected,reason:'Gift fixture correction'},ids.staff);
  };

  await check('A Direct gift waives item and courier charges, consumes stock, and creates no payment or expense',async()=>{
    await assert.rejects(quote({...base,gift:true},ids.customer),/Authorized|staff/i);
    await assert.rejects(quote({...base,gift:true,order_source:'in_person'}),/Direct orders/i);
    const q=await quote({...base,gift:true,discount:{kind:'percent',value:100},delivery_fee_recipient:'courier'});
    assert.equal(q.gift,true);
    assert.deepEqual([q.subtotal_cents,q.discount_cents,q.delivery_cents,q.total_cents,q.items[0].unit_price_cents],[0,0,0,0,0]);
    const before=await h.remaining({id:product.box_flavors[0]},date);
    const gift=await create({...base,gift:true,paid:false});
    assert.equal(gift.payment_status,'paid');
    assert.equal(gift.pos_payment.method,'gift');
    assert.equal(gift.fulfillment_status,'confirmed');
    assert.equal(gift.delivery_charge.fee_cents,0);
    assert.equal(await payments(gift),0);
    assert.equal(await ledger(gift),0);
    assert.equal(await reportRows(gift),0);
    assert.equal(await h.remaining({id:product.box_flavors[0]},date),before-3);
    assert((await h.allocations(gift.id)).every(row=>row.state==='committed'));
    await assert.rejects(h.action('pos_set_delivery_fee',gift,{recipient:'elio',fee_cents:100,reason:'Fixture'}),/waived/i);
    await assert.rejects(preview(gift,{gift:false}),/no-charge order/i);
    const amended=await edit(gift,{items:[{...line,quantity:2}]});
    assert.equal(amended.gift,true);assert.equal(amended.total_cents,0);
    assert.equal(await h.remaining({id:product.box_flavors[0]},date),before-6);
  })();

  await check('An old zero-payment discount or unpaid order can be marked as a gift without recording cash',async()=>{
    const zero=await create({...base,method:'pickup',discount:{kind:'percent',value:100},paid:true,payment:{method:'cash',cash_received_cents:0}});
    assert.equal(zero.total_cents,0);
    assert.equal(await reportRows(zero),2);
    const converted=await edit(zero,{gift:true});
    assert.equal(converted.gift,true);
    assert.equal(converted.discount_cents,0);
    assert.equal(await payments(converted),1);
    assert.equal(await reportRows(converted),0);

    const unpaid=await create({...base,paid:false});
    const marked=await edit(unpaid,{gift:true});
    assert.equal(marked.fulfillment_status,'confirmed');
    assert.equal(marked.payment_status,'paid');
    assert.equal(marked.total_cents,0);
    assert.equal(await payments(marked),0);
    assert((await h.allocations(marked.id)).every(row=>row.state==='committed'));

    const paid=await create({...base,paid:true,payment:{method:'cash',cash_received_cents:13000}});
    await assert.rejects(preview(paid,{gift:true}),/recorded payments/i);
    assert.equal((await h.order(paid.id)).total_cents,13000);
  })();
}
