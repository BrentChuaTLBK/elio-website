import { env, service } from "../_shared/server.ts";
import { renderNewsletterEmail } from "../_shared/newsletter-emails.ts";

// A single, leased Elio segment is prepared for the reviewed recipient snapshot.
// It stays locked until Resend finishes sending. Other brands are never changed.
export function resendMarketing(key: string) {
  let previous = 0;
  async function request(path: string, method = "GET", body?: unknown, allowMissing = false): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 180 - (Date.now() - previous))));
    previous = Date.now();
    const response = await fetch(`https://api.resend.com${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
    });
    if (allowMissing && response.status === 404) return null;
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(response.status === 401 || response.status === 403
      ? "Broadcast access unavailable. Configure RESEND_BROADCAST_API_KEY with full access."
      : `Resend marketing request failed (${response.status}). The campaign was not sent through the email API.`);
    return result;
  }
  async function list(path: string): Promise<any[]> {
    const rows: any[] = []; let after = "";
    for (let page = 0; page < 1000; page++) {
      const result = await request(`${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      if (!Array.isArray(result.data)) throw new Error("Invalid marketing list response.");
      rows.push(...result.data);
      if (!result.has_more) return rows;
      const next = result.data.at(-1)?.id;
      if (!next || next === after) throw new Error("Marketing pagination did not advance.");
      after = next;
    }
    throw new Error("Marketing pagination exceeded the safety limit.");
  }
  return { request, list };
}

export async function checkBroadcastConfiguration(key: string) {
  const config = await service("newsletter_broadcast_config");
  if (!config?.segment_id || !config?.topic_id) return { configured: false };
  const api = resendMarketing(env("RESEND_BROADCAST_API_KEY") || key);
  // Read-only access checks. No contacts, drafts, or emails are created here.
  await api.request(`/segments/${config.segment_id}`);
  await api.request(`/topics/${config.topic_id}`);
  await api.request("/broadcasts?limit=1");
  return { configured: true, transport: "resend_broadcasts" };
}

async function reconcilePreferences(api: ReturnType<typeof resendMarketing>, topic: string) {
  const rows = await service("newsletter_broadcast_contacts");
  for (const row of Array.isArray(rows) ? rows : []) {
    const contact = await api.request(`/contacts/${row.contact_id}`, "GET", undefined, true);
    if (!contact) {
      await service("newsletter_broadcast_contact_checked", { subscriber_id: row.id, unsubscribed: true });
      continue;
    }
    const topics = await api.list(`/contacts/${row.contact_id}/topics`);
    const preference = topics.find(t => t.id === topic);
    const unsubscribed = contact.unsubscribed === true || preference?.subscription !== "opt_in";
    if (row.status !== "subscribed" && !unsubscribed) {
      await api.request(`/contacts/${row.contact_id}/topics`, "PATCH", [{ id: topic, subscription: "opt_out" }]);
    }
    await service("newsletter_broadcast_contact_checked", { subscriber_id: row.id, unsubscribed });
  }
}

export async function deliverBroadcasts(key: string) {
  const stats = { transport: "resend_broadcasts", accepted: 0, pending: false, failed: false, configured: true };
  const api = resendMarketing(env("RESEND_BROADCAST_API_KEY") || key);
  let lease: any = null;
  const started = Date.now();
  try {
    const config = await service("newsletter_broadcast_config");
    if (config?.topic_id) await reconcilePreferences(api, config.topic_id);
    const claim = await service("newsletter_broadcast_claim");
    if (claim?.configured === false) { stats.configured = false; return stats; }
    if (claim?.busy) { stats.pending = true; return stats; }
    if (claim?.idle) return stats;
    if (!claim?.job || !claim.lease_token || !claim.segment_id || !claim.topic_id) throw new Error("Invalid broadcast claim.");
    let job = claim.job;
    lease = { campaign_id: job.campaign_id, lease_token: claim.lease_token };
    const action = (name: string, payload: Record<string, unknown> = {}) => service(`newsletter_broadcast_${name}`, { ...lease, ...payload });
    const segment = claim.segment_id, topic = claim.topic_id;

    if (job.status === "preparing") {
      for (const row of job.recipients.filter((r: any) => !r.synced)) {
        if (Date.now() - started > 35000) { stats.pending = true; return stats; }
        let contact = await api.request(`/contacts/${encodeURIComponent(row.email)}`, "GET", undefined, true);
        if (!contact) {
          const created = await api.request("/contacts", "POST", { email: row.email });
          if (!created.id) throw new Error("Contact creation was not confirmed.");
          contact = await api.request(`/contacts/${created.id}`);
        }
        if (!contact.id || String(contact.email).toLowerCase() !== row.email) throw new Error("Contact identity mismatch.");
        const topics = await api.list(`/contacts/${contact.id}/topics`);
        const preference = topics.find(t => t.id === topic);
        // A known opt-out must never be overwritten by list synchronization.
        if (contact.unsubscribed || (row.contact_id && preference?.subscription !== "opt_in")) {
          await action("contact", { subscriber_id: row.id, unsubscribed: true });
          continue;
        }
        if (!row.contact_id && preference?.subscription !== "opt_in") {
          await api.request(`/contacts/${contact.id}/topics`, "PATCH", [{ id: topic, subscription: "opt_in" }]);
        }
        await api.request(`/contacts/${contact.id}/segments/${segment}`, "POST");
        job = await action("contact", { subscriber_id: row.id, contact_id: contact.id });
      }

      job = await action("context");
      if (job.recipients.some((r: any) => !r.synced)) { stats.pending = true; return stats; }
      // Remove only membership of the dedicated Elio sending segment. Contacts,
      // their global preferences, and TLB segments/topics are never deleted.
      const desired = new Set(job.recipients.map((r: any) => r.email));
      const members = await api.list(`/segments/${segment}/contacts`);
      for (const member of members) {
        if (Date.now() - started > 35000) { stats.pending = true; return stats; }
        if (!desired.has(String(member.email).toLowerCase())) await api.request(`/contacts/${member.id}/segments/${segment}`, "DELETE");
      }
      if (!desired.size) { await action("status", { status: "cancelled" }); return stats; }
      // Provider/global opt-outs may have changed since earlier sync batches.
      for (const member of members.filter(m => desired.has(String(m.email).toLowerCase()) && m.unsubscribed)) {
        const row = job.recipients.find((r: any) => r.email === String(member.email).toLowerCase());
        await action("contact", { subscriber_id: row.id, unsubscribed: true });
        stats.pending = true; return stats;
      }
      const verified = await api.list(`/segments/${segment}/contacts`);
      const actual = new Set(verified.map(m => String(m.email).toLowerCase()));
      if (actual.size !== desired.size || [...desired].some(email => !actual.has(email))) {
        for (const row of job.recipients.filter((r: any) => !actual.has(r.email))) {
          if (Date.now() - started > 35000) break;
          await api.request(`/contacts/${row.contact_id}/segments/${segment}`, "POST");
        }
        // Membership changed outside the worker: recheck rather than silently
        // broadening the reviewed audience or sending to an incomplete group.
        throw new Error("Broadcast audience changed in Resend. Review segment membership before retrying.");
      }
      if (!job.provider_payload) {
        const rendered = renderNewsletterEmail({ ...job.payload, broadcast: true });
        job = await action("payload", { provider_payload: {
          segment_id: segment, topic_id: topic, send: false,
          name: `Elio ${job.campaign_id} — ${job.payload.campaign.subject}`,
          from: env("NEWSLETTER_EMAIL_FROM") || "Elio Newsletter <news@eliocheesecakes.com>",
          reply_to: "elio.cheesecakes@gmail.com", subject: job.payload.campaign.subject, ...rendered,
        } });
      }
      if (!job.provider_id) {
        // Draft creation and sending are separate. Losing this acknowledgement
        // can leave an unused draft, but can never cause an unrecorded send.
        const created = await api.request("/broadcasts", "POST", job.provider_payload);
        if (!created.id) throw new Error("Broadcast draft creation was not confirmed.");
        job = await action("created", { provider_id: created.id });
      }
      const remote = await api.request(`/broadcasts/${job.provider_id}`);
      if (remote.status !== "draft") throw new Error("This broadcast changed in Resend before approval. Review it before proceeding.");
      for (const field of ["segment_id", "topic_id", "from", "subject", "html", "text"]) {
        if (remote[field] !== job.provider_payload[field]) throw new Error("Broadcast content changed in Resend. Review it before proceeding.");
      }
      // Recheck local consent and the exact audience immediately before sending.
      job = await action("begin_send", { emails: [...actual] });
    }

    if (["submitting", "queued"].includes(job.status)) {
      if (!job.provider_id) throw new Error("Submitted broadcast is missing its saved identity.");
      let remote = await api.request(`/broadcasts/${job.provider_id}`);
      if (remote.status === "draft" && job.status === "submitting") {
        await api.request(`/broadcasts/${job.provider_id}/send`, "POST", {});
        remote = await api.request(`/broadcasts/${job.provider_id}`);
      }
      if (remote.status === "sent") { await action("status", { status: "sent" }); stats.accepted = 1; }
      else if (["queued", "sending", "scheduled"].includes(remote.status)) { await action("status", { status: "queued" }); stats.pending = true; }
      else if (["failed", "cancelled", "canceled"].includes(remote.status)) { await action("status", { status: remote.status === "failed" ? "failed" : "cancelled" }); stats.failed = true; }
      else { stats.pending = true; }
    }
  } catch (error) {
    stats.failed = true;
    if (lease) try { await service("newsletter_broadcast_error", { ...lease, error: error instanceof Error ? error.message : "Broadcast delivery needs review." }); } catch { /* Preserve the claim until expiry. */ }
  } finally {
    if (lease) try { await service("newsletter_broadcast_release", lease); } catch { /* The lease expires safely. */ }
  }
  return stats;
}
