import { env, json, rpc, service } from "../_shared/server.ts";
import { renderEmail } from "../_shared/emails.ts";
import { deliverNewsletters } from "./newsletter-worker.ts";

// This worker accepts only the high-entropy credential held privately in Vault.
// The verifier RPC can be called only by the service role, not browser sessions.
export async function handle(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = request.headers.get("x-worker-token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Worker authorization required." }, 401);
  try {
    if (await rpc("elio_email_worker_authorized", { p_token: token }) !== true) return json({ error: "Worker authorization required." }, 401);
  } catch { return json({ error: "Worker authorization unavailable." }, 503); }

  const key = env("RESEND_API_KEY"), sender = env("EMAIL_FROM");
  // Check configuration before leasing messages: missing secrets must not use up retries.
  if (!key || !sender) return json({ error: "Configure Elio RESEND_API_KEY and EMAIL_FROM." }, 503);
  const stats = { accepted: 0, skipped: 0, failed: 0, acknowledgement_pending: 0, maintenance: null as any };
  try {
    stats.maintenance = await service("maintenance");
    const claimed = await service("claim_emails", { limit: 3 });
    if (!Array.isArray(claimed)) throw new Error("Invalid claim response.");
    for (const row of claimed) {
      let accepted = false;
      try {
        const first = Date.parse(row.first_attempt_at || "");
        if (!Number.isFinite(first) || Date.now() - first >= 23 * 60 * 60 * 1000) {
          await service("email_failed", { id: row.id, lease_token: row.lease_token, terminal: true, error: "Automatic delivery stopped before the provider idempotency window expires. Review Resend logs before retrying." });
          stats.failed++;
          continue;
        }
        const current = await service("prepare_email", { id: row.id, lease_token: row.lease_token });
        if (current?.skip) { stats.skipped++; continue; }
        if (!current?.payload || !current.to_email || !current.event_key) throw new Error("Invalid leased message.");
        const rendered = renderEmail(current.payload);
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `elio/${current.event_key}` },
          body: JSON.stringify({ from: sender, to: [current.to_email], reply_to: "elio.cheesecakes@gmail.com", subject: String(current.subject || "Elio order update").replace(/[\r\n]/g, " "), ...rendered }),
          signal: AbortSignal.timeout(12000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.id) throw new Error("Provider acceptance unconfirmed.");
        accepted = true;
        await service("email_sent", { id: row.id, lease_token: row.lease_token, provider_id: result.id });
        stats.accepted++;
      } catch {
        stats.failed++;
        if (accepted) stats.acknowledgement_pending++;
        const error = accepted
          ? "Provider accepted the email but acknowledgement failed. Retry the same event key; check Resend logs before manual intervention."
          : "Email delivery is unconfirmed. Check sender verification, message configuration, and Resend logs. Retry uses the same event key.";
        try { await service("email_failed", { id: row.id, lease_token: row.lease_token, error }); }
        catch { /* An expired lease can be reclaimed with the same idempotency key. */ }
      }
    }
    const newsletter = await deliverNewsletters(key, sender);
    return json({ ...stats, newsletter });
  } catch { return json({ ...stats, error: "Email maintenance unavailable; existing leases remain retryable." }, 503); }
}
