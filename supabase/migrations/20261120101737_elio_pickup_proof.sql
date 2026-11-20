begin;

alter table elio.orders add column pickup_proof_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('pickup-proofs','pickup-proofs',false,20971520,array['image/jpeg','image/png','image/webp','image/heic','image/heif']);

-- Only the private upload and signed-view services can reach this helper.
create function elio.pickup_proof_service(p_action text,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  o elio.orders;
  oid uuid:=(p->>'order_id')::uuid;
  staff_id uuid:=(p->>'user_id')::uuid;
  path text:=p->>'path';
begin
  if p_action='read_pickup_proof' then
    select * into o from elio.orders where id=oid;
    perform elio.require(o.id is not null and o.method='pickup' and o.pickup_proof_path is not null
      and elio.can_access(o,staff_id,p->>'token'),'Pickup proof is unavailable for this order.');
    return jsonb_build_object('path',o.pickup_proof_path);
  end if;

  perform elio.assert_staff(staff_id,false);
  perform elio.require(elio.is_verified(staff_id),'Verify your staff email before attaching pickup proof.');
  select * into o from elio.orders where id=oid for update;
  perform elio.require(o.id is not null and o.method='pickup','Choose a pickup order.');
  if p_action='authorize_pickup_upload' then
    return jsonb_build_object('allowed',true,'previous',o.pickup_proof_path);
  end if;
  perform elio.require(p_action='commit_pickup_proof' and path ~ ('^'||oid::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$'),'Invalid pickup proof.');
  if o.pickup_proof_path=path then return jsonb_build_object('saved',true); end if;
  perform elio.require(o.pickup_proof_path is not distinct from (p->>'previous'),'Another photo was saved. Reopen the order before uploading again.');
  update elio.orders set pickup_proof_path=path, revision=revision+1 where id=oid;
  perform elio.audit(oid,staff_id,'pickup_proof_uploaded','Pickup photo attached.',null,null,true);
  return jsonb_build_object('saved',true,'previous',o.pickup_proof_path);
end $$;
revoke all on function elio.pickup_proof_service(text,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
  model text;
  target regprocedure;
  flag text:='''proof_submitted'',o.proof_path is not null';
  gateway text:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
  anchor text:=' if left(p_action,9)=''calendar_''';
begin
  foreach target in array array['elio.order_json(uuid,boolean,boolean)'::regprocedure,'elio.order_list_json(elio.orders)'::regprocedure] loop
    model:=pg_get_functiondef(target);
    perform elio.require((length(model)-length(replace(model,flag,'')))/length(flag)=1,'Missing order proof field.');
    execute replace(model,flag,flag||',''has_pickup_proof'',o.method=''pickup'' and o.pickup_proof_path is not null');
  end loop;
  perform elio.require((length(gateway)-length(replace(gateway,anchor,'')))/length(anchor)=1,'Missing pickup proof service hook.');
  execute replace(gateway,anchor,' if p_action in (''read_pickup_proof'',''authorize_pickup_upload'',''commit_pickup_proof'') then return elio.pickup_proof_service(p_action,p_payload);end if;'||chr(10)||anchor);
end $patch$;
commit;
