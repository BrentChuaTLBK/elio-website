import { env, service } from "../_shared/server.ts";
import { newsletterHeaders, renderNewsletterEmail } from "../_shared/newsletter-emails.ts";

// Called only after the existing worker has verified its private Vault credential.
// Order and marketing queues are separate; a newsletter error never stops orders.
export async function deliverNewsletters(key: string, sender: string) {
  const stats = { accepted: 0, skipped: 0, failed: 0, acknowledgement_pending: 0, unavailable: false };
  try {
    const claimed = await service("newsletter_claim_emails", { limit: 3 });
    if (!Array.isArray(claimed)) throw new Error("Invalid newsletter claim.");
    for (const row of claimed) {
      let accepted = false, terminal = false;
      try {
        const first = Date.parse(row.first_attempt_at || "");
        if (!Number.isFinite(first) || Date.now() - first >= 23 * 60 * 60 * 1000) {
          await service("newsletter_email_failed", { id: row.id, lease_token: row.lease_token, terminal: true, error: "Automatic delivery stopped before provider idempotency expires. Review delivery logs before retrying." });
          stats.failed++; continue;
        }
        // Wait before the final consent checks, keeping them close to delivery.
        // This also respects the shared provider's two-request-per-second default.
        await new Promise(resolve => setTimeout(resolve, 550));
        let current = await service("newsletter_prepare_email", { id: row.id, lease_token: row.lease_token });
        if (current?.skip) { stats.skipped++; continue; }
        if (!current?.to_email || !current.event_key || !current.payload) throw new Error("Invalid newsletter message.");
        if (!current.provider_payload) {
          const rendered = renderNewsletterEmail(current.payload);
          const provider_payload = {
            from: sender, to: [current.to_email], reply_to: "elio.cheesecakes@gmail.com",
            subject: String(current.subject || "Elio Newsletter").replace(/[\r\n]/g, " "),
            ...rendered, headers: newsletterHeaders(current.payload, env("SUPABASE_URL")),
          };
          current = await service("newsletter_prepare_email", { id: row.id, lease_token: row.lease_token, provider_payload });
          if (current?.skip) { stats.skipped++; continue; }
        }
        if (!current?.provider_payload) throw new Error("Newsletter snapshot was not saved.");
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `elio/newsletter/${current.event_key}` },
          body: JSON.stringify(current.provider_payload), signal: AbortSignal.timeout(12000),
        });
        terminal = response.status >= 400 && response.status < 500 && ![408,409,425,429].includes(response.status);
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.id) throw new Error("Newsletter provider acceptance unconfirmed.");
        accepted = true;
        await service("newsletter_email_sent", { id: row.id, lease_token: row.lease_token, provider_id: result.id });
        stats.accepted++;
      } catch {
        stats.failed++; if (accepted) stats.acknowledgement_pending++;
        try {
          await service("newsletter_email_failed", {
            id: row.id, lease_token: row.lease_token, terminal: !accepted && terminal,
            error: accepted ? "Provider accepted this newsletter; acknowledgement failed. Retry the same saved message and event key." : terminal ? "Email provider rejected this newsletter. Check recipient suppression and message configuration before retrying." : "Newsletter acceptance is unconfirmed. Retry uses the same saved message and event key.",
          });
        } catch { /* The unchanged event can be reclaimed after lease expiry. */ }
      }
    }
  } catch { stats.unavailable = true; }
  return stats;
}
