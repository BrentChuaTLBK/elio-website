-- Adapted from TLB's multi-category catalog. Membership never creates stock.
-- Elio keeps separate category lists for flavors and boxes.
do $$
declare c record; flavor_category uuid;
begin
 for c in select * from elio.categories loop
  if exists(select 1 from elio.products where data->>'category_id'=c.id::text and data->>'kind'='flavor') then
   if exists(select 1 from elio.products where data->>'category_id'=c.id::text and data->>'kind'<>'flavor') then
    flavor_category:=gen_random_uuid();
    insert into elio.categories values(flavor_category,c.data||jsonb_build_object('id',flavor_category,'scope','flavors'));
    update elio.products set data=jsonb_set(data,'{category_id}',to_jsonb(flavor_category)) where data->>'category_id'=c.id::text and data->>'kind'='flavor';
   else
    update elio.categories set data=data||jsonb_build_object('scope','flavors') where id=c.id;
   end if;
  end if;
 end loop;
 update elio.categories set data=data||jsonb_build_object('scope','boxes') where not data ? 'scope';
end $$;

update elio.products p set data=p.data||jsonb_build_object(
 'category_ids',case when p.data->>'category_id' is null then '[]'::jsonb else jsonb_build_array(p.data->>'category_id') end,
 'category_sort_orders',case when p.data->>'category_id' is null then '{}'::jsonb else jsonb_build_object(p.data->>'category_id',coalesce((p.data->>'sort_order')::integer,0)) end
);

-- Preserve the existing public flavor families when moving to editable categories.
do $$
declare family text; family_name text; cid uuid; p record;
begin
 foreach family in array array['classic','tea','rich'] loop
  family_name:=case family when 'classic' then 'Classic' when 'tea' then 'Tea' else 'Rich & bold' end;
  select id into cid from elio.categories where data->>'scope'='flavors' and lower(data->>'name')=lower(family_name) limit 1;
  if cid is null then
   cid:=gen_random_uuid();
   insert into elio.categories values(cid,jsonb_build_object('id',cid,'scope','flavors','name',family_name,'sort_order',case family when 'classic' then 1 when 'tea' then 2 else 3 end));
  end if;
  for p in select * from elio.products where data->>'kind'='flavor' and coalesce(data->>'collection_category',case data->>'slug' when 'vanilla' then 'classic' when 'gorgonzola' then 'classic' when 'matcha' then 'tea' when 'hojicha' then 'tea' when 'chocolate' then 'rich' when 'ube' then 'rich' when 'speculoos' then 'rich' end)=family loop
   if not p.data->'category_ids' ? cid::text then
    update elio.products set data=data||jsonb_build_object('category_ids',(data->'category_ids')||to_jsonb(cid::text),
     'category_id',coalesce(data->>'category_id',cid::text),'category_sort_orders',(data->'category_sort_orders')||jsonb_build_object(cid::text,coalesce((data->>'sort_order')::integer,0))) where id=p.id;
   end if;
  end loop;
 end loop;
end $$;

create function elio.normalize_product_categories(p_data jsonb,p_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare ids jsonb; old_data jsonb; positions jsonb:='{}'; cid text; n integer; scope text;
begin
 select data into old_data from elio.products where id=p_id;
 scope:=case when p_data->>'kind'='flavor' then 'flavors' else 'boxes' end;
 ids:=case when p_data ? 'category_ids' then p_data->'category_ids'
  when p_data ? 'category_id' then case when nullif(p_data->>'category_id','') is null then '[]'::jsonb else jsonb_build_array(p_data->>'category_id') end
  else coalesce(old_data->'category_ids','[]') end;
 perform elio.require(jsonb_typeof(ids)='array' and jsonb_array_length(ids)<=100,'Choose valid categories.');
 perform elio.require(not exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string'),'Choose valid categories.');
 perform elio.require(jsonb_array_length(ids)=(select count(distinct value) from jsonb_array_elements_text(ids)),'Choose each category once.');
 for cid in select value from jsonb_array_elements_text(ids) loop
  perform elio.require(exists(select 1 from elio.categories where id=cid::uuid and data->>'scope'=scope),'Choose a category for this item type.');
  if old_data->'category_sort_orders' ? cid then n:=(old_data->'category_sort_orders'->>cid)::integer;
  else select coalesce(max((data->'category_sort_orders'->>cid)::integer),0)+1 into n from elio.products; end if;
  positions:=positions||jsonb_build_object(cid,n);
 end loop;
 if old_data is not null then n:=coalesce((old_data->>'sort_order')::integer,0);
 else select coalesce(max((data->>'sort_order')::integer),0)+1 into n from elio.products where (data->>'kind'='flavor')=(scope='flavors'); end if;
 return p_data||jsonb_build_object('category_ids',ids,'category_id',ids->0,'category_sort_orders',positions,'sort_order',n);
end $$;

create function elio.remove_product_category(p_data jsonb,p_id uuid) returns jsonb
language sql set search_path='' as $$
 with remaining as (select coalesce(jsonb_agg(value order by ord),'[]') ids from jsonb_array_elements(p_data->'category_ids') with ordinality x(value,ord) where value<>to_jsonb(p_id::text))
 select p_data||jsonb_build_object('category_ids',ids,'category_id',ids->0,'category_sort_orders',(p_data->'category_sort_orders')-p_id::text) from remaining
$$;

create function elio.save_catalog_category(p_data jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare rid uuid:=coalesce((p_data->>'id')::uuid,gen_random_uuid()); previous jsonb; n integer; scope text:=p_data->>'scope'; result jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 perform elio.require(scope in ('flavors','boxes'),'Choose a category list.');
 perform elio.require(length(trim(p_data->>'name')) between 1 and 100,'Category name is required.');
 select data into previous from elio.categories where id=rid;
 perform elio.require(previous is null or previous->>'scope'=scope,'A category cannot move between flavors and boxes.');
 if previous is null then select coalesce(max((data->>'sort_order')::integer),0)+1 into n from elio.categories where data->>'scope'=scope;
 else n:=coalesce((previous->>'sort_order')::integer,0); end if;
 result:=jsonb_build_object('id',rid,'name',trim(p_data->>'name'),'scope',scope,'sort_order',n);
 insert into elio.categories values(rid,result) on conflict(id) do update set data=excluded.data;
 return result;
end $$;

-- Each scoped editor submits a complete snapshot. Reject stale or partial lists.
create function elio.reorder_catalog(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare scope text:=p_payload->>'scope'; kind text:=p_payload->>'kind'; current_items jsonb; snapshot jsonb; expected jsonb;
 groups jsonb; g jsonb; group_id text; seen text[]:='{}'; wanted text[]; members text[]; item text; position integer; result jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 perform elio.require(scope in ('flavors','boxes') and kind in ('products','categories'),'Choose a valid catalog list.');
 if kind='products' then
  select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by id),'[]') into current_items from elio.products where (data->>'kind'='flavor')=(scope='flavors');
 else
  select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by id),'[]') into current_items from elio.categories where data->>'scope'=scope;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','sort_order',coalesce((x->>'sort_order')::integer,0))||case when kind='products' then jsonb_build_object('category_ids',x->'category_ids','category_sort_orders',x->'category_sort_orders') else '{}'::jsonb end order by x->>'id'),'[]') into snapshot from jsonb_array_elements(current_items) x;
 perform elio.require(jsonb_typeof(p_payload->'expected')='array','Provide the saved order.');
 select coalesce(jsonb_agg(x order by x->>'id'),'[]') into expected from jsonb_array_elements(p_payload->'expected') x;
 perform elio.require(snapshot=expected,'The catalog changed in another session. Close this list and refresh before rearranging again.');
 groups:=case when kind='categories' then jsonb_build_array(jsonb_build_object('category_id','*','ids',p_payload->'ids')) else p_payload->'groups' end;
 perform elio.require(jsonb_typeof(groups)='array','Provide the complete display order.');
 for g in select value from jsonb_array_elements(groups) loop
  group_id:=g->>'category_id';
  perform elio.require(group_id='*' or (kind='products' and exists(select 1 from elio.categories where id::text=group_id and data->>'scope'=scope)),'Category not found.');
  perform elio.require(not group_id=any(seen),'Each category must appear once.');seen:=array_append(seen,group_id);
  perform elio.require(jsonb_typeof(g->'ids')='array','Provide a list of item IDs.');
  perform elio.require(not exists(select 1 from jsonb_array_elements(g->'ids') x where jsonb_typeof(x)<>'string'),'Invalid item IDs.');
  select coalesce(array_agg(value order by ord),'{}') into wanted from jsonb_array_elements_text(g->'ids') with ordinality x(value,ord);
  select coalesce(array_agg(x->>'id'),'{}') into members from jsonb_array_elements(current_items) x where group_id='*' or x->'category_ids' ? group_id;
  perform elio.require(cardinality(wanted)=cardinality(members) and cardinality(wanted)=(select count(distinct id) from unnest(wanted) id) and wanted <@ members,'The catalog changed or items are missing. Refresh before rearranging again.');
  for item,position in select value,ord::integer from jsonb_array_elements_text(g->'ids') with ordinality x(value,ord) loop
   if kind='categories' then update elio.categories set data=jsonb_set(data,'{sort_order}',to_jsonb(position)) where id=item::uuid;
   else update elio.products set data=jsonb_set(data,case when group_id='*' then array['sort_order'] else array['category_sort_orders',group_id] end,to_jsonb(position)),updated_at=now() where id=item::uuid; end if;
  end loop;
 end loop;
 perform elio.require('*'=any(seen),'Include the All items order.');
 if kind='products' then
  perform elio.require(not exists(select 1 from jsonb_array_elements(current_items) x cross join lateral jsonb_array_elements_text(x->'category_ids') cid where not cid=any(seen)),'Include every category order.');
  select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name',id),'[]') into result from elio.products where (data->>'kind'='flavor')=(scope='flavors');
 else select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by (data->>'sort_order')::integer,id),'[]') into result from elio.categories where data->>'scope'=scope; end if;
 return jsonb_build_object('items',result);
end $$;
revoke all on function elio.normalize_product_categories(jsonb,uuid),elio.remove_product_category(jsonb,uuid),elio.save_catalog_category(jsonb),elio.reorder_catalog(jsonb) from public,anon,authenticated;

create function elio.flavor_removal_impact(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare rid uuid:=nullif(p_payload->>'id','')::uuid; current_month date:=date_trunc('month',now() at time zone 'Asia/Manila')::date; result jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 select coalesce(jsonb_agg(jsonb_build_object('month',m.month,'orders',impact.orders,'pieces',impact.pieces) order by m.month),'[]') into result
 from elio.flavor_menus m cross join lateral (
  select count(distinct o.id)::integer orders,coalesce(sum((item->>'quantity')::integer*(f->>'quantity')::integer),0)::integer pieces
  from elio.orders o cross join lateral jsonb_array_elements(o.data->'items') item cross join lateral jsonb_array_elements(coalesce(item->'flavor_contents','[]')) f
  where o.payment_status='paid' and not o.refund_label and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery')
   and date_trunc('month',o.fulfillment_date)::date=m.month and f->>'product_id'=rid::text
 ) impact
 where rid=any(m.flavor_ids) and m.month between current_month and (current_month+interval '1 month')::date
  and (coalesce((p_payload->>'hidden')::boolean,false) or not coalesce((p_payload->>case when m.month=current_month then 'current_month' else 'next_month' end)::boolean,false));
 return jsonb_build_object('months',result);
end $$;
revoke all on function elio.flavor_removal_impact(jsonb) from public,anon,authenticated;

do $patch$
declare def text; before text;
begin
 def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 before:=$old$ if p_action='catalog' then$old$;
 perform elio.require(position(before in def)>0,'Missing catalog hook.');
 def:=replace(def,before,$new$ if p_action='flavor_removal_impact' then return elio.flavor_removal_impact(p_payload); end if;
 if p_action='reorder_catalog' then return elio.reorder_catalog(p_payload); end if;
 if p_action='save_category' then return elio.save_catalog_category(p_payload->'category'); end if;
 if p_action='catalog' then$new$);
 before:=$old$if row_data->>'category_id' is not null then perform elio.require(exists(select 1 from elio.categories where id=(row_data->>'category_id')::uuid),'Category not found.'); end if;$old$;
 perform elio.require(position(before in def)>0,'Missing product category validator.');
 def:=replace(def,before,'row_data:=elio.normalize_product_categories(row_data,rid);');
 before:=$old$update elio.products set data=jsonb_set(data,'{category_id}','null') where data->>'category_id'=rid::text;$old$;
 perform elio.require(position(before in def)>0,'Missing category removal hook.');
 def:=replace(def,before,$new$update elio.products set data=elio.remove_product_category(data,rid),updated_at=now() where data->'category_ids' ? rid::text;$new$);
 execute def;
 def:=pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure);
 before:=$old$'collection_category',data->>'collection_category',$old$;
 perform elio.require(position(before in def)>0,'Missing public flavor category metadata.');
 def:=replace(def,before,$new$'category_ids',data->'category_ids','category_sort_orders',data->'category_sort_orders',$new$);
 before:=$old$elio.flavor_menu_data(true)||jsonb_build_object('flavors',$old$;
 def:=replace(def,before,$new$elio.flavor_menu_data(true)||jsonb_build_object('categories',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name',id),'[]') from elio.categories where data->>'scope'='flavors'),'flavors',$new$);
 execute def;
end $patch$;
