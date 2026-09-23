-- Public flavor metadata lets the shop check every date against shared stock.
-- Only storefront fields are returned; no team, order, or account data.
do $adapt$
declare def text; old text;
begin
 def:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),'');
 old:=$x$return jsonb_build_object('products',result,'categories',$x$;
 if position(old in def)=0 then raise exception 'Missing catalog flavor metadata patch point'; end if;
 def:=replace(def,old,$x$return jsonb_build_object('products',result,'flavors',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',data->>'name','price_cents',data->'price_cents','active',data->'active','in_rotation',data->'in_rotation','photos',data->'photos') order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]') from elio.products where data->>'kind'='flavor'),'categories',$x$);
 execute def;
end $adapt$;

-- Staff payment-review emails use the same saved recipe as the customer order.
-- A later recipe change must never change the production breakdown in an order.
do $adapt$
declare def text; old text;
begin
 def:=replace(pg_get_functiondef('elio.queue_order_review_emails(uuid)'::regprocedure),chr(13),'');
 old:=$x$'selection_labels',coalesce(line->'selection_labels','[]'::jsonb),$x$;
 if position(old in def)=0 then raise exception 'Missing saved recipe email patch point'; end if;
 def:=replace(def,old,$x$'selection_labels',coalesce(line->'selection_labels','[]'::jsonb),'flavor_contents',coalesce(line->'flavor_contents','[]'::jsonb),$x$);
 execute def;
end $adapt$;
