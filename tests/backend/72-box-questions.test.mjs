import assert from 'node:assert/strict';

export default async function({state,check}){
  const h=state.h,date=await h.day(4);
  const flavor=await h.product({kind:'flavor',price_cents:500,lead_days:0});
  await h.inventory(flavor,date,100);
  const packing={id:'packing',label:'How should we pack your box?',required_count:1,choices:[
    {id:'paper',label:'Paper bag only',surcharge_cents:0,active:true},
    {id:'insulated',label:'Insulated bag + ice (recommended for long travel)',surcharge_cents:3750,active:true}
  ]};
  const note={id:'note',label:'Include a card?',required_count:1,choices:[{id:'no',label:'No card',surcharge_cents:0}]};
  const boxes=[];
  for(const kind of ['set','custom_box']) boxes.push(await h.product({kind,box_flavors:[flavor.id,flavor.id,flavor.id],box_questions:[packing,note],price_cents:80000,lead_days:0}));
  await check('A fixed or custom box requires exactly one answer to each question and charges the saved price per box',async()=>{
    const catalog=await h.api('catalog',{fulfillment_date:date});
    for(const box of boxes){
      const data=catalog.products.find(p=>p.id===box.id);
      assert.equal(data.box_questions.length,2);
      const selections=box.kind==='custom_box'?{flavors:{[flavor.id]:3}}:{};
      const options={...selections,packing:{insulated:1},note:{no:1}};
      const sale=sels=>h.checkout(box,date,{items:[{...h.item(box,2,sels),unit_price_cents:1}]});
      for(const [action,actor] of [['quote',null],['pos_quote',h.ids.owner]]){
        const quote=sels=>h.api(action,{...sale(sels),order_source:'direct'},actor);
        for(const bad of [selections,{...options,packing:{}},{...options,packing:{paper:1,insulated:1}},{...options,packing:{unknown:1}},{...options,unconfigured:{yes:1}}]){
          await assert.rejects(quote(bad),/choose|unknown|invalid/i);
        }
        const priced=await quote(options),base=box.kind==='set'?80000:81500;
        assert.equal(priced.total_cents,2*(base+3750));
        assert.equal((await quote({...options,packing:{paper:1}})).total_cents,2*base);
        const row=priced.items[0];assert.equal(row.stock_requirements.length,1);
        assert.equal(row.stock_requirements[0].quantity,3);
        assert.equal(row.selection_labels.find(x=>x.group_id==='packing').label,packing.choices[1].label);
      }
    }
  })();
  await check('Saved orders retain answers and charges after the owner edits a question',async()=>{
    const box=boxes[0],answers={packing:{insulated:1},note:{no:1}};
    const order=await h.api('create_order',h.checkout(box,date,{items:[h.item(box,1,answers)]}));
    const current=await h.scalar('select data from elio.products where id=$1',[box.id]);
    await h.api('save_product',{product:{...current,box_questions:[]}},h.ids.owner);
    const saved=(await h.order(order.id)).items[0];
    assert.equal(saved.unit_price_cents,83750);assert.equal(saved.selection_labels.find(x=>x.group_id==='packing').surcharge_cents,3750);
    const edit=await h.api('preview_edit_order',{order_id:order.id,revision:order.revision,changes:{items:[h.item(box,2,answers)]}},h.ids.owner);
    assert.equal(edit.subtotal_cents,167500);
    assert.equal((await h.api('quote',h.checkout(box,date))).subtotal_cents,80000);
    await assert.rejects(h.api('quote',h.checkout(box,date,{items:[h.item(box,1,answers)]})),/unknown/i);
    for(const q of [{...packing,id:'flavors'},{...packing,required_count:2},{...packing,choices:[]},{...packing,choices:[{...packing.choices[0],surcharge_cents:-1}]}]){
      await assert.rejects(h.api('save_product',{product:{...current,box_questions:[q]}},h.ids.owner),/question|choice|extra price/i);
    }
  })();
}
