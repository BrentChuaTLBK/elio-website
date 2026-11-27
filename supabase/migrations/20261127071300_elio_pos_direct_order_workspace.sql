-- POS amendments keep the actor, revision and before/after snapshots even without a note.
begin;
do $migration$
declare
  definition text;
  old_rule text := $rule$if p_action='edit_order' then perform elio.require(reason is not null,'An amendment reason is required.'); end if;$rule$;
  new_rule text := $rule$if p_action='edit_order' and coalesce(o.data->>'order_source','website') not in ('direct','in_person') then
   perform elio.require(reason is not null,'An amendment reason is required.');
  end if;$rule$;
  old_link text := $rule$perform elio.require(o.data->>'order_source'='direct','Only direct orders use customer payment links.');$rule$;
  new_link text := $rule$perform elio.require(coalesce(o.data->>'order_source','website') in ('website','direct','in_person'),'This order has no customer link.');$rule$;
begin
  definition := pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  if strpos(definition,old_rule)=0 then raise exception 'Amendment rule missing'; end if;
  execute replace(definition,old_rule,new_rule);

  definition := pg_get_functiondef('elio.pos_order_action(text,jsonb)'::regprocedure);
  if strpos(definition,old_link)=0 or strpos(definition,'perform elio.assert_staff(auth.uid(),false);') not between 1 and strpos(definition,old_link) then
    raise exception 'Staff order link rule missing';
  end if;
  execute replace(definition,old_link,new_link);
end;
$migration$;
commit;
