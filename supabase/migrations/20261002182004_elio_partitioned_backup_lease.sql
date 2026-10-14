begin;
alter table elio.order_backup_connection add column proof_archive_revisions jsonb not null default '{}';
-- Heartbeats are fenced by the existing opaque lease. They cannot revive an
-- expired or replaced lease, and never advance the last successful revision.
do $$ declare definition text;old text;begin
 definition:=pg_get_functiondef('elio.order_backup_service(text,jsonb)'::regprocedure);
 old:=$old$ elsif p_action='order_backup_finish' then$old$;
 perform elio.require(position(old in definition)>0,'Missing backup finish hook.');
 definition:=replace(definition,old,$new$ elsif p_action='order_backup_checkpoint' then
  perform elio.require(c.enabled and c.lease_token=(p_payload->>'lease_token')::uuid and c.lease_until>clock_timestamp(),'Backup lease expired.');
  perform elio.require((p_payload->>'revision')::bigint<=c.revision,'Invalid backup revision.');
  update elio.order_backup_connection set lease_until=clock_timestamp()+interval '3 minutes' where id;
  return jsonb_build_object('ok',true);
 elsif p_action='order_backup_finish' then$new$);
 old:=$old$'proof_archive_file_ids',to_jsonb(c.proof_archive_file_ids),$old$;
 perform elio.require(position(old in definition)>0,'Missing archive IDs hook.');
 definition:=replace(definition,old,old||$new$'proof_archive_revisions',c.proof_archive_revisions,$new$);
 -- Explicit literal avoids replacing the status function or unrelated fields.
 old:='proof_archive_id=case when code is null then';
 perform elio.require(position(old in definition)>0,'Missing archive completion hook.');
 definition:=replace(definition,old,$new$proof_archive_revisions=case when code is null then coalesce(p_payload->'proof_archive_revisions',proof_archive_revisions) else proof_archive_revisions end,
   proof_archive_id=case when code is null then$new$);
 definition:=replace(definition,'''readback'',''proof_files''','''readback'',''proof_files'',''timeout''');
 execute definition;
 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 old:='''order_backup_begin'',''order_backup_finish''';
 perform elio.require(position(old in definition)>0,'Missing backup service dispatch hook.');
 execute replace(definition,old,'''order_backup_begin'',''order_backup_checkpoint'',''order_backup_finish''');
end $$;
commit;
