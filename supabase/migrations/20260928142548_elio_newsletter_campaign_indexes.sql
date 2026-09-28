begin;
-- Campaign completion, cancellation and retry updates filter the outbox by
-- campaign_id. Keep those updates bounded as newsletter history grows.
create index if not exists newsletter_outbox_campaign_id_idx
 on elio.newsletter_outbox(campaign_id);
-- Cover the author relationship when checking or removing an auth account.
create index if not exists newsletter_campaigns_created_by_idx
 on elio.newsletter_campaigns(created_by);
commit;
