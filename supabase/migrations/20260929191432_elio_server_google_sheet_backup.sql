begin;
-- Replace the unactivated Apps Script connection with the existing server-side
-- Google service-account model. Revoke the superseded setup credential.
update elio.order_backup_connection set token_digest=null,enabled=false,run_id=null,last_error=null;
alter table elio.order_backup_connection add column spreadsheet_id text,
 add column revision bigint not null default 1,add column synced_revision bigint not null default 0,
 add column lease_token uuid,add column lease_until timestamptz,
 add column service_account_email text,add column cloud_project text;
create or replace function elio.order_backup_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'spreadsheet_id',spreadsheet_id,'configured_at',configured_at,'last_started_at',last_started_at,
 'last_success_at',last_success_at,'snapshot_at',snapshot_at,'active_count',active_count,'paid_history_count',paid_history_count,
 'last_error',last_error,'pending',revision>synced_revision,'busy',coalesce(lease_until>statement_timestamp(),false),
 'service_account_email',service_account_email,'cloud_project',cloud_project,
 'state',case when not enabled then 'disconnected' when last_error is not null then 'error' when last_success_at is null then 'pending'
 when revision>synced_revision and last_success_at<statement_timestamp()-interval '15 minutes' then 'stale' else 'connected' end)
 from elio.order_backup_connection where id
$$;
create or replace function elio.order_backup_admin(p_action text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform elio.assert_staff(auth.uid(),true);
 if p_action='order_backup_setup' then raise exception 'Use the server Google Sheets connection.';end if;
 if p_action='order_backup_sync_now' then
  update elio.order_backup_connection set revision=revision+1 where id and enabled;
  if to_regprocedure('elio.invoke_backup_worker()') is not null then perform elio.invoke_backup_worker();end if;
 end if;
 if p_action='order_backup_disconnect' then update elio.order_backup_connection set enabled=false,lease_token=null,lease_until=null where id;end if;
 return elio.order_backup_status();
end $$;
create or replace function elio.order_backup_service(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c elio.order_backup_connection; lease uuid; snapshot jsonb; code text;
begin
 if p_action='order_backup_identity' then
  perform elio.require(coalesce(p_payload->>'service_account_email','')~'^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$','Invalid Google identity.');
  update elio.order_backup_connection set service_account_email=p_payload->>'service_account_email',cloud_project=left(p_payload->>'cloud_project',150) where id;return '{}'::jsonb;
 end if;
 if p_action in ('order_backup_owner_access','order_backup_connect') then
  perform elio.assert_staff((p_payload->>'user_id')::uuid,true);
  if p_action='order_backup_connect' then
   perform elio.require((p_payload->>'spreadsheet_id')~'^[A-Za-z0-9_-]{20,150}$','Invalid spreadsheet reference.');
   update elio.order_backup_connection set spreadsheet_id=p_payload->>'spreadsheet_id',enabled=true,configured_by=(p_payload->>'user_id')::uuid,
    configured_at=clock_timestamp(),last_error=null,revision=revision+1,lease_token=null,lease_until=null where id;
  end if;
  return jsonb_build_object('allowed',true,'connection',elio.order_backup_status());
 end if;
 select * into c from elio.order_backup_connection where id for update;
 if p_action='order_backup_begin' then
  if not c.enabled or c.spreadsheet_id is null then return jsonb_build_object('skipped','disabled');end if;
  if c.lease_until>clock_timestamp() then return jsonb_build_object('skipped','busy');end if;
  if c.revision=c.synced_revision and c.last_error is null and c.last_success_at>clock_timestamp()-interval '1 day' and not coalesce((p_payload->>'force')::boolean,false) then return jsonb_build_object('skipped','unchanged');end if;
  lease:=extensions.gen_random_uuid();snapshot:=elio.paid_order_recovery_snapshot();
  update elio.order_backup_connection set lease_token=lease,lease_until=clock_timestamp()+interval '3 minutes',last_started_at=clock_timestamp() where id;
  return jsonb_build_object('lease_token',lease,'revision',c.revision,'spreadsheet_id',c.spreadsheet_id,'snapshot',snapshot);
 elsif p_action='order_backup_finish' then
  perform elio.require(c.enabled and c.lease_token=(p_payload->>'lease_token')::uuid and c.lease_until>clock_timestamp(),'Backup lease expired.');
  code:=p_payload->>'error';if code is not null and code not in ('access','api_disabled','quota','network','configuration','too_large','readback') then code:='network';end if;
  update elio.order_backup_connection set lease_token=null,lease_until=null,last_error=code,
   synced_revision=case when code is null then (p_payload->>'revision')::bigint else synced_revision end,
   last_success_at=case when code is null then clock_timestamp() else last_success_at end,
   snapshot_at=case when code is null then (p_payload->>'snapshot_at')::timestamptz else snapshot_at end,
   active_count=case when code is null then (p_payload->>'active_count')::integer else active_count end,
   paid_history_count=case when code is null then (p_payload->>'paid_history_count')::integer else paid_history_count end where id;
  return elio.order_backup_status();
 end if;
 raise exception 'Unsupported backup action';
end $$;
create function elio.mark_order_backup_dirty() returns trigger language plpgsql security invoker set search_path='' as $$
declare relevant boolean:=true;identifier uuid;
begin
 if tg_table_name='orders' then
  relevant:=false;
  if tg_op<>'INSERT' then relevant:=old.payment_status='paid';end if;
  if tg_op<>'DELETE' then relevant:=relevant or new.payment_status='paid';end if;
  identifier:=case when tg_op='DELETE' then old.id else new.id end;
  relevant:=relevant or exists(select 1 from elio.affiliate_orders where order_id=identifier);
 elsif tg_table_name in ('payments','allocations') then
  identifier:=case when tg_op='DELETE' then old.order_id else new.order_id end;
  relevant:=exists(select 1 from elio.orders where id=identifier and payment_status='paid');
 end if;
 if not relevant then return null;end if;
 update elio.order_backup_connection set revision=revision+1 where id;
 return null;
end $$;
do $$ declare name text;begin
 foreach name in array array['orders','payments','allocations','affiliate_orders','affiliate_ledger','affiliate_payouts','affiliate_codes','affiliates'] loop
  execute format('create trigger elio_backup_changed after insert or update or delete on elio.%I for each row execute function elio.mark_order_backup_dirty()',name);
 end loop;
end $$;
revoke all on function elio.mark_order_backup_dirty() from public,anon,authenticated,service_role;
do $$ declare definition text;old_hook text;new_hook text;begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old_hook:='''order_backup_status'',''order_backup_setup'',''order_backup_disconnect''';
 perform elio.require(position(old_hook in definition)>0,'Missing backup owner hook.');execute replace(definition,old_hook,'''order_backup_status'',''order_backup_sync_now'',''order_backup_disconnect''');
 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 old_hook:=' if p_action in (''order_backup_export'',''order_backup_ack'',''order_backup_fail'') then';
 new_hook:=' if p_action in (''order_backup_identity'',''order_backup_owner_access'',''order_backup_connect'',''order_backup_begin'',''order_backup_finish'') then';
 perform elio.require(position(old_hook in definition)>0,'Missing backup service hook.');execute replace(definition,old_hook,new_hook);
end $$;
commit;
