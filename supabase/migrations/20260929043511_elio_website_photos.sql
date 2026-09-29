begin;
create table elio.website_photos (
 slot text primary key,
 path text,
 alt text not null default '',
 position_x integer not null default 50 check(position_x between 0 and 100),
 position_y integer not null default 50 check(position_y between 0 and 100),
 revision integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table elio.website_photos enable row level security;
revoke all on elio.website_photos from public,anon,authenticated,service_role;
insert into elio.website_photos(slot) select unnest(array[
 'home_hero','home_box','home_story','home_gift','home_gift_detail',
 'story_hero','story_plated','story_kitchen','story_explore',
 'shop_hero','shop_gift','shop_gift_mobile','flavors_hero','flavors_box'
]);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('website-images','website-images',true,5242880,array['image/webp']);
create policy elio_owner_website_photo_insert on storage.objects for insert to authenticated
with check (
 bucket_id='website-images'
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
 and (select public.shop_api('account_access','{}'::jsonb,null)->>'role')='owner'
);

create function elio.website_photo_data() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('photos',coalesce(jsonb_object_agg(slot,to_jsonb(p)-'slot'-'updated_at'),'{}'::jsonb))
 from elio.website_photos p
$$;
create function elio.save_website_photo(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current elio.website_photos; key text; next_path text;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(jsonb_typeof(p)='object','Provide photo settings.');
 perform elio.require(jsonb_typeof(p->'slot')='string','Choose a website photo.');
 select * into current from elio.website_photos where slot=p->>'slot' for update;
 perform elio.require(found,'Choose a valid website photo.');
 perform elio.require(jsonb_typeof(p->'revision')='number' and p->>'revision' ~ '^[0-9]{1,9}$','Refresh the photo before saving.');
 perform elio.require((p->>'revision')::integer=current.revision,'This photo changed. Reload the saved photo before saving again.');
 perform elio.require(p ? 'path' and jsonb_typeof(p->'path') in ('string','null'),'Choose an uploaded photo or restore the original.');
 next_path:=p->>'path';
 if next_path is not null then
  perform elio.require(next_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$','Choose a valid uploaded photo.');
  perform elio.require(next_path=current.path or split_part(next_path,'/',1)=auth.uid()::text,'Choose a photo you uploaded.');
  perform elio.require(exists(select 1 from storage.objects where bucket_id='website-images' and name=next_path and metadata->>'mimetype'='image/webp'),'Upload the photo before saving.');
  perform elio.require(jsonb_typeof(p->'alt')='string' and length(btrim(p->>'alt')) between 1 and 240,'Add an image description of up to 240 characters.');
  foreach key in array array['position_x','position_y'] loop
   perform elio.require(jsonb_typeof(p->key)='number' and p->>key ~ '^[0-9]{1,3}$','Choose a valid crop position.');
   perform elio.require((p->>key)::integer between 0 and 100,'Crop position must be between 0 and 100.');
  end loop;
 end if;
 update elio.website_photos set path=next_path,
  alt=case when next_path is null then '' else btrim(p->>'alt') end,
  position_x=case when next_path is null then 50 else (p->>'position_x')::integer end,
  position_y=case when next_path is null then 50 else (p->>'position_y')::integer end,
  revision=revision+1,updated_at=clock_timestamp() where slot=current.slot returning * into current;
 return to_jsonb(current)-'slot'-'updated_at';
end $$;
revoke all on function elio.website_photo_data(),elio.save_website_photo(jsonb) from public,anon,authenticated,service_role;

-- Public photo reads have no order, inventory, or transaction-wide lock work.
do $$
declare definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text:=$hook$ if p_action='account_access' then$hook$;
begin
 perform elio.require(position(hook in definition)>0,'Missing account access dispatch hook.');
 execute replace(definition,hook,$new$ if p_action='website_photos' then return elio.website_photo_data();end if;
 if p_action='save_website_photo' then return elio.save_website_photo(p_payload);end if;
$new$||hook);
end $$;
commit;
