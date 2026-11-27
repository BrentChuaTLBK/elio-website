import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {accountingFixture} from './accounting-fixture.mjs';

export default async function({state,check}){
  const h=state.h,{api,ids}=h;
  await check('Staff can copy the customer link from an opened order and POS amendments keep their audit without a mandatory note',async()=>{
    const {product,date}=await accountingFixture(h);
    const sale={order_source:'direct',method:'pickup',fulfillment_date:date,items:[h.item(product)],gift:true};
    const pos=await api('pos_create_order',{...sale,expected_quote:await api('pos_quote',sale,ids.staff),idempotency_key:randomUUID()},ids.staff);
    const web=await api('create_order',h.checkout(product,date),ids.customer);
    for(const order of [pos,web]){
      const {token}=await api('pos_payment_link',{order_id:order.id},ids.staff);
      assert.equal((await api('get_order',{order_id:order.id},null,token)).id,order.id);
      await assert.rejects(api('pos_payment_link',{order_id:order.id},ids.customer),/authorized|staff/i);
      assert.equal((await h.order(order.id)).access_token,undefined);
    }
    const amend=(order,reason)=>api('edit_order',{order_id:order.id,revision:order.revision,idempotency_key:randomUUID(),changes:{instructions:'Updated pickup instructions'},reason},ids.staff);
    const edited=await amend(pos,'  ');
    assert.equal(edited.revision,pos.revision+1);
    assert.equal(edited.gift,true);
    const log=edited.history.findLast(event=>event.action==='edit_order');
    assert(log.before&&log.after);
    assert.equal(log.reason??null,null);
    const withNote=await amend(edited,'Customer confirmed the time');
    assert.equal(withNote.history.findLast(event=>event.action==='edit_order').reason,'Customer confirmed the time');
    await assert.rejects(amend(web,''),/amendment reason/i);
  })();
}
