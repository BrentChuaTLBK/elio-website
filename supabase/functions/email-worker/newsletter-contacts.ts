import { env, service } from "../_shared/server.ts";
import { resendMarketing } from "../_shared/resend-marketing.ts";

// Runs on the existing minute worker, even with no campaign. Durable versions
// preserve changes made while a provider request is in flight; errors retry.
export async function syncNewsletterContacts(key: string) {
  const stats = { synced: 0, removed: 0, retained: 0, failed: 0, pending: false, configured: true };
  const api = resendMarketing(env("RESEND_BROADCAST_API_KEY") || key);
  let token: string | null = null;
  const started = Date.now();
  try {
    const claim = await service("newsletter_contact_claim");
    if (claim?.configured === false) { stats.configured = false; return stats; }
    if (claim?.busy) { stats.pending = true; return stats; }
    if (claim?.idle) return stats;
    if (!claim?.lease_token || !claim.topic_id || !claim.segment_id || !Array.isArray(claim.rows)) throw new Error("Invalid contact synchronization claim.");
    token = claim.lease_token;
    const topic = claim.topic_id, segment = claim.segment_id;
    for (const row of claim.rows) {
      if (Date.now() - started > 30000) { stats.pending = true; break; }
      const identity = { lease_token: token, subscriber_id: row.subscriber_id, version: row.version };
      const action = (name: string, payload: Record<string, unknown> = {}) => service(`newsletter_contact_${name}`, { ...identity, ...payload });
      try {
        const local = await action("context");
        if (local?.stale) { stats.pending = true; continue; }
        if (!local?.email || !["subscribed", "unsubscribed", "suppressed"].includes(local.status)) throw new Error("Invalid contact synchronization context.");
        let contact = await api.request(`/contacts/${encodeURIComponent(local.email)}`, "GET", undefined, true);
        // Only a new explicit Join can create a contact or restore Elio topic consent.
        if (!contact && local.status === "subscribed" && local.fresh_consent) {
          const created = await api.request("/contacts", "POST", { email: local.email });
          if (!created.id) throw new Error("Contact creation was not confirmed.");
          contact = await api.request(`/contacts/${created.id}`);
        }
        if (contact && (!contact.id || String(contact.email).toLowerCase() !== local.email)) throw new Error("Contact identity mismatch.");
        let topics = contact ? await api.list(`/contacts/${contact.id}/topics`) : [];
        let subscribed = local.status === "subscribed";
        const providerOptOut = !contact || contact.unsubscribed === true || (!local.fresh_consent && topics.find(t => t.id === topic)?.subscription !== "opt_in");
        if (subscribed && providerOptOut) {
          const recorded = await action("opt_out");
          if (recorded?.stale) { stats.pending = true; continue; }
          if (!recorded?.version) throw new Error("Provider unsubscribe was not recorded.");
          identity.version = recorded.version;
          subscribed = false;
        }
        // Recheck consent after reads/creation, immediately before provider writes.
        if ((await action("context"))?.stale) { stats.pending = true; continue; }
        if (subscribed && contact) {
          if (local.fresh_consent && topics.find(t => t.id === topic)?.subscription !== "opt_in") {
            await api.request(`/contacts/${contact.id}/topics`, "PATCH", [{ id: topic, subscription: "opt_in" }]);
          }
          await api.request(`/contacts/${contact.id}/segments/${segment}`, "POST");
          topics = await api.list(`/contacts/${contact.id}/topics`);
          if (topics.find(t => t.id === topic)?.subscription !== "opt_in") throw new Error("Elio topic subscription was not confirmed.");
        } else if (contact) {
          if (topics.find(t => t.id === topic)?.subscription === "opt_in") {
            await api.request(`/contacts/${contact.id}/topics`, "PATCH", [{ id: topic, subscription: "opt_out" }]);
          }
          await api.request(`/contacts/${contact.id}/segments/${segment}`, "DELETE", undefined, true);
          // Read all topics again: keep contacts still subscribed to TLB or any
          // other topic in this shared account. Never alter those subscriptions.
          topics = await api.list(`/contacts/${contact.id}/topics`);
          if (topics.some(t => t.subscription === "opt_in")) stats.retained++;
          else {
            if ((await action("context"))?.stale) { stats.pending = true; continue; }
            const removed = await api.request(`/contacts/${contact.id}`, "DELETE", undefined, true);
            if (removed && removed.deleted !== true) throw new Error("Contact deletion was not confirmed.");
            // A successful DELETE acknowledgement can precede provider read consistency.
            // Leave durable work pending until a read confirms absence.
            const stillPresent = await api.request(`/contacts/${encodeURIComponent(local.email)}`, "GET", undefined, true);
            if (stillPresent) throw new Error("Contact removal is awaiting provider confirmation.");
            contact = null;stats.removed++;
          }
        }
        const saved = await action("done", { contact_id: contact?.id || null });
        if (saved?.stale) stats.pending = true;
        else stats.synced++;
      } catch (error) {
        stats.failed++;
        try { await action("error", { error: error instanceof Error ? error.message : "Contact synchronization needs review." }); } catch { /* Lease/version changes leave durable work pending. */ }
      }
    }
  } catch { stats.failed++; }
  finally {
    if (token) try { await service("newsletter_contact_release", { lease_token: token }); } catch { /* The lease expires safely. */ }
  }
  return stats;
}
