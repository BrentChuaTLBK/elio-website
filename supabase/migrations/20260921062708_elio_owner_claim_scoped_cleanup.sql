-- Supabase API sessions enable safeupdate. Consume only the claimed owner's
-- reservation; an unqualified DELETE would abort and roll back activation.
do $fix$
declare
  definition text := pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  old_cleanup text := 'if found then delete from elio.pending_owners; end if;';
  new_cleanup text := 'if found then delete from elio.pending_owners p using auth.users a where a.id=u and p.email=lower(a.email); end if;';
begin
  if position(old_cleanup in definition)=0 then
    raise exception 'Expected Elio owner cleanup was not found';
  end if;
  execute replace(definition,old_cleanup,new_cleanup);
end
$fix$;
