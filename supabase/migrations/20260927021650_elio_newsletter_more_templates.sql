-- Extend the existing private validator without changing campaign fields,
-- owner authorization, or immutable queued campaign snapshots.
do $$
declare definition text:=pg_get_functiondef('elio.newsletter_campaign_data(jsonb)'::regprocedure);
 hook text:=$old$in ('spotlight','offer','letter')$old$;
begin
 perform elio.require(position(hook in definition)>0,'Newsletter template validation hook was not found.');
 execute replace(definition,hook,$new$in ('spotlight','offer','letter','editorial','invitation','digest')$new$);
end $$;
