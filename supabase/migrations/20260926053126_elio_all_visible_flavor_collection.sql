-- The full collection is independent of monthly availability. Public menu
-- membership still comes exclusively from published menus; a draft assignment
-- must not change a flavor's presence or reveal a membership-derived flag.
do $patch$
declare
 def text:=pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure);
 hook text;
begin
 hook:=$old$,
    'collection_only',not exists(select 1 from elio.flavor_menus m where m.month in (current_month,next_month) and elio.products.id=any(m.flavor_ids))$old$;
 perform elio.require(position(hook in def)>0,'Missing collection membership flag hook.');
 def:=replace(def,hook,'');

 hook:=$old$
    and (not exists(select 1 from elio.flavor_menus m where m.month in (current_month,next_month) and elio.products.id=any(m.flavor_ids))
     or exists(select 1 from elio.flavor_menus m where m.month in (current_month,next_month) and m.published and elio.products.id=any(m.flavor_ids)))$old$;
 perform elio.require(position(hook in def)>0,'Missing monthly collection exclusion hook.');
 def:=replace(def,hook,'');
 execute def;
end $patch$;
