begin;
alter table elio.order_backup_connection add column pending_since timestamptz;
-- Existing pending work has no reliable original change timestamp. Start its
-- alert window now rather than treating an old, unchanged copy as an outage.
update elio.order_backup_connection set pending_since=clock_timestamp() where revision>synced_revision;
create function elio.track_backup_pending_age() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.revision<=new.synced_revision then new.pending_since:=null;
 elsif old.revision<=old.synced_revision or new.synced_revision>old.synced_revision then new.pending_since:=clock_timestamp();
 else new.pending_since:=coalesce(old.pending_since,clock_timestamp());end if;
 return new;
end $$;
create trigger elio_backup_pending_age before update of revision,synced_revision on elio.order_backup_connection for each row execute function elio.track_backup_pending_age();
revoke all on function elio.track_backup_pending_age() from public,anon,authenticated,service_role;
do $$declare definition text:=pg_get_functiondef('elio.order_backup_status()'::regprocedure);old text:=$old$when last_success_at is null then 'pending'
 when revision>synced_revision and last_success_at<statement_timestamp()-interval '15 minutes' then 'stale'$old$;begin
 perform elio.require(position(old in definition)>0,'Missing backup status age condition.');
 definition:=replace(definition,old,$new$when revision>synced_revision and pending_since<statement_timestamp()-interval '15 minutes' then 'stale'
 when last_success_at is null then 'pending'$new$);
 definition:=replace(definition,'''pending'',revision>synced_revision,','''pending'',revision>synced_revision,''pending_since'',pending_since,');
 execute definition;
end $$;
commit;
