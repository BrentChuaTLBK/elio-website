-- Optional editorial footage is published separately from product photos and private order media.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('flavor-videos','flavor-videos',true,20971520,array['video/mp4','video/webm','video/quicktime']);

create policy elio_owner_flavor_video_insert on storage.objects for insert to authenticated
with check (
  bucket_id='flavor-videos'
  and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov)$')
  and (select public.shop_api('account_access','{}'::jsonb,null) @> '{"role":"owner","mfa_required":false}'::jsonb)
);

-- Store only the object key. Replacing and removing an attachment use the same
-- revision-checked product save as the cover photo.
create function elio.validate_flavor_video() returns trigger
language plpgsql set search_path='' as $$
declare path text;
begin
  if not (new.data ? 'texture_video_path') then
    if tg_op='UPDATE' and old.data ? 'texture_video_path' then
      new.data:=new.data||jsonb_build_object('texture_video_path',old.data->'texture_video_path');
    end if;
    return new;
  end if;
  path:=new.data->>'texture_video_path';
  if coalesce(path,'')='' then
    new.data:=new.data-'texture_video_path';
  elsif tg_op='INSERT' or path is distinct from old.data->>'texture_video_path' or new.data->>'kind' is distinct from old.data->>'kind' then
    perform elio.require(new.data->>'kind'='flavor' and jsonb_typeof(new.data->'texture_video_path')='string'
      and path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov)$'
      and exists(select 1 from storage.objects where bucket_id='flavor-videos' and name=path),
      'Upload a texture video for this flavor before saving.');
  end if;
  return new;
end $$;
revoke all on function elio.validate_flavor_video() from public,anon,authenticated;
create trigger validate_flavor_video before insert or update of data on elio.products
for each row execute function elio.validate_flavor_video();

do $migration$
declare def text; hook text;
begin
  def:=pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure);
  hook:=$h$'collection_details',data->'collection_details',$h$;
  perform elio.require(position(hook in def)>0,'Missing public flavor detail fields.');
  def:=replace(def,hook,hook||$s$'texture_video_path',data->'texture_video_path',$s$);
  hook:=$h$if p_payload ? 'collection_details' then product:=product||jsonb_build_object('collection_details',p_payload->'collection_details'); end if;$h$;
  perform elio.require(position(hook in def)>0,'Missing flavor editor save.');
  execute replace(def,hook,hook||$s$
  if p_payload ? 'texture_video_path' then product:=product||jsonb_build_object('texture_video_path',p_payload->'texture_video_path'); end if;$s$);

  def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  hook:=$h$'collection_details',data->'collection_details',$h$;
  perform elio.require(position(hook in def)>0,'Missing homepage flavor detail fields.');
  execute replace(def,hook,hook||$s$'texture_video_path',data->'texture_video_path',$s$);
end $migration$;
