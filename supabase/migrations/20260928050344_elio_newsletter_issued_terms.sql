begin;

-- Read each immutable issued promo, never the current welcome offer policy.
-- Keep the existing owner-only dispatch and refund-aware conversion report.
do $$
declare definition text:=pg_get_functiondef('elio.newsletter_offer_report(jsonb)'::regprocedure);
 hook text:='select p.id,n.email,p.code,n.confirmed_at issued_at,n.offer_expires_at expires_at,';
begin
 perform elio.require(position(hook in definition)>0,'Missing issued newsletter offer report hook.');
 execute replace(definition,hook,hook||$terms$
   jsonb_build_object('kind',p.data->'kind','value',p.data->'value',
    'min_subtotal_cents',p.data->'min_subtotal_cents','cap_cents',p.data->'cap_cents') offer_terms,$terms$);
end $$;

commit;
