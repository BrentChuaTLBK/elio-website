-- One flavor record supplies both editors and every public flavor popup.
create function elio.validate_flavor_details(p jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare field text; limit_length integer;
begin
 if p->>'kind'<>'flavor' then return p; end if;
 if p ? 'tagline' then
  perform elio.require(jsonb_typeof(p->'tagline')='string' and length(p->>'tagline')<=100,'Use a short description of 100 characters or fewer.');
 end if;
 if p ? 'collection_details' then
  perform elio.require(jsonb_typeof(p->'collection_details')='object','Provide valid flavor popup details.');
  for field in select jsonb_object_keys(p->'collection_details') loop
   perform elio.require(field in ('product_type','serving'),'Use only supported flavor popup fields.');
   limit_length:=case when field='serving' then 500 else 120 end;
   perform elio.require(jsonb_typeof(p->'collection_details'->field)='string' and length(p->'collection_details'->>field)<=limit_length,'Flavor popup field '||field||' must be text of '||limit_length||' characters or fewer.');
  end loop;
 end if;
 return p;
end $$;
revoke all on function elio.validate_flavor_details(jsonb) from public,anon,authenticated;

do $patch$
declare def text; hook text;
begin
 def:=pg_get_functiondef('elio.validate_product()'::regprocedure);
 hook:=' return new;';
 perform elio.require(position(hook in def)>0,'Missing flavor details validation hook.');
 execute replace(def,hook,' new.data:=elio.validate_flavor_details(new.data);'||chr(10)||hook);

 def:=pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure);
 hook:=$old$'description',data->>'description','tagline',data->>'tagline',$old$;
 perform elio.require(position(hook in def)>0,'Missing public flavor details hook.');
 def:=replace(def,hook,hook||$new$'collection_details',data->'collection_details',$new$);
 hook:=$old$if p_payload ? 'category_ids' then product:=product||jsonb_build_object('category_ids',p_payload->'category_ids'); end if;$old$;
 perform elio.require(position(hook in def)>0,'Missing flavor editor save hook.');
 def:=replace(def,hook,hook||$new$
  if p_payload ? 'collection_details' then product:=product||jsonb_build_object('collection_details',p_payload->'collection_details'); end if;$new$);
 execute def;
end $patch$;
