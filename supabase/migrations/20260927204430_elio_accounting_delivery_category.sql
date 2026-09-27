begin;
select pg_advisory_xact_lock(841721950318::bigint);
do $$ declare destination uuid;cost_category uuid;definition text;hook text;begin
 select id into strict destination from elio.accounting_categories where system_key='delivery_fee';
 select id into strict cost_category from elio.accounting_categories where system_key='delivery_cost';
 perform elio.require(not exists(select 1 from elio.accounting_categories where merged_into is null and lower(btrim(name))='delivery' and id<>destination),'A manual Delivery category already exists; review it before combining automatic delivery categories.');
 update elio.accounting_categories set name='Delivery',revision=revision+1 where id=destination;
 -- Retain the internal system key and audit references. Public reports resolve
 -- this alias to Delivery; each entry retains its own income/expense type.
 update elio.accounting_categories set merged_into=destination,archived=true,revision=revision+1 where id=cost_category;
 definition:=pg_get_functiondef('elio.accounting_rows_v2(date,date)'::regprocedure);
 hook:='select l.id,l.entry_date,l.category_id,l.amount_cents';
 perform elio.require(position(hook in definition)>0,'Missing accounting ledger category hook.');
 definition:=replace(definition,hook,'select l.id,l.entry_date,coalesce(c.merged_into,l.category_id),l.amount_cents');
 hook:='select d.order_id,d.cost_date,c.id,d.amount_cents';
 perform elio.require(position(hook in definition)>0,'Missing delivery cost category hook.');
 execute replace(definition,hook,'select d.order_id,d.cost_date,coalesce(c.merged_into,c.id),d.amount_cents');
end $$;
commit;
