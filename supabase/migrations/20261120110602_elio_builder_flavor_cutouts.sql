-- The cover and ordered gallery keep their existing meaning. The builder uses
-- one optional cutout stored on the same flavor as its price and stock ID.
do $migration$
declare
  definition text;
  anchor text;
begin
  definition := pg_get_functiondef('elio.validate_product()'::regprocedure);
  anchor := 'new.data:=elio.validate_flavor_details(new.data);';
  perform elio.require(position(anchor in definition)>0,'Missing flavor metadata validator.');
  definition := replace(definition, anchor, anchor || $body$
  if tg_op='UPDATE' and old.data ? 'builder_cutout_url' and not (new.data ? 'builder_cutout_url') then
    -- Older owner clients can save metadata without supplying this field.
    new.data:=new.data||jsonb_build_object('builder_cutout_url',old.data->'builder_cutout_url');
  end if;
  if new.data ? 'builder_cutout_url' then
    if new.data->'builder_cutout_url'='null'::jsonb or new.data->>'builder_cutout_url'='' then
      new.data:=new.data-'builder_cutout_url';
    else
      perform elio.require(new.data->>'kind'='flavor' and jsonb_typeof(new.data->'builder_cutout_url')='string'
        and length(new.data->>'builder_cutout_url')<=2048
        and (new.data->>'builder_cutout_url') ~ '^(https://[^/[:space:]]+/[^[:space:]]+|assets/([A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.(png|webp))$',
        'Choose a valid uploaded cake cutout for this flavor.');
    end if;
  end if;
$body$);
  execute definition;

  definition := pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure);
  anchor := $needle$if p_payload ? 'collection_details' then product:=product||jsonb_build_object('collection_details',p_payload->'collection_details'); end if;$needle$;
  perform elio.require(position(anchor in definition)>0,'Missing flavor editor metadata save.');
  execute replace(definition,anchor,anchor || $body$
  if p_payload ? 'builder_cutout_url' then
    product:=product||jsonb_build_object('builder_cutout_url',p_payload->'builder_cutout_url');
  end if;
$body$);

  definition := pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  anchor := $needle$'in_rotation',data->'in_rotation','photos',data->'photos','collection_hidden',data->'collection_hidden'$needle$;
  perform elio.require(position(anchor in definition)>0,'Missing ordering catalog flavor photo projection.');
  execute replace(definition,anchor,anchor || $body$,'builder_cutout_url',case
    when coalesce((data->>'active')::boolean,false) and not coalesce((data->>'collection_hidden')::boolean,false)
    then data->'builder_cutout_url' end$body$);
end $migration$;
