import { credentials, endpoint, field, HttpError, json, readBody, service, verifiedUser } from "../_shared/http.ts";
import { renderNewsletterEmail } from "../_shared/newsletter-emails.ts";

async function clientHash(request: Request): Promise<string> {
  const address = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0,128);
  const bytes = new TextEncoder().encode(`${credentials().key}\0newsletter\0${address}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2,"0")).join("");
}

async function ownerApi(request: Request, action: string, payload: Record<string, unknown>): Promise<any> {
  await verifiedUser(request, true);
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/rpc/shop_api`, {
    method: "POST", headers: { apikey: key, Authorization: request.headers.get("authorization") || "", "Content-Type": "application/json" },
    body: JSON.stringify({ p_action: action, p_payload: payload, p_token: null }), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) throw new HttpError(response.status === 401 || response.status === 403 ? 403 : 400, "This newsletter action is unavailable. Sign in as an owner and check the draft.");
  return result;
}

const handlePost = endpoint(async (request, headers) => {
  headers.set("Referrer-Policy", "no-referrer");
  const url = new URL(request.url);
  const oneClick = url.searchParams.get("action") === "unsubscribe" && request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded");
  let input: any;
  if (oneClick) {
    const body = new URLSearchParams(new TextDecoder().decode(await readBody(request,1024)));
    if (body.get("List-Unsubscribe") !== "One-Click") throw new HttpError(400, "Invalid unsubscribe request.");
    input = { action: "unsubscribe", token: url.searchParams.get("token") };
  } else {
    // A 20,000-character campaign may use four UTF-8 bytes per character.
    const body = await readBody(request, 128 * 1024);
    try {
      input = JSON.parse(new TextDecoder().decode(body));
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    } catch { throw new HttpError(400, "A valid JSON object is required."); }
  }
  const action = field(input.action, "Action", 40, true);
  if (action === "activate_account") {
    const user_id = await verifiedUser(request, true);
    const result = await service("newsletter_activate_account", { user_id });
    return json({ status: result.status }, 200, headers);
  }
  if (action === "preview_campaign" || action === "test_campaign") {
    const preview = await ownerApi(request, "newsletter_preview_campaign", { campaign: input.campaign });
    const rendered = renderNewsletterEmail(preview);
    if (action === "test_campaign") {
      const recipient = field(input.recipient, "Test recipient", 254, true);
      const result = await ownerApi(request, "newsletter_test_campaign", { campaign: input.campaign, recipient });
      return json(result, 200, headers);
    }
    return json({ ...rendered, recipient_count: preview.recipient_count, campaign_id: preview.campaign_id || preview.campaign?.id, revision: preview.revision ?? preview.campaign?.revision, updated_at: preview.updated_at || preview.campaign?.updated_at }, 200, headers);
  }
  const ip_hash = await clientHash(request);
  if (action === "subscribe") {
    // A honeypot receives the same reply while creating no subscriber or email.
    if (input.website) return json({ accepted: true }, 200, headers);
    if (input.consent !== true) throw new HttpError(400, "Please agree to receive the Elio newsletter before subscribing.");
    const email = field(input.email, "Email address", 254, true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    const source = field(input.source, "Signup source", 30, true);
    if (!["home_popup", "home_footer", "account"].includes(source)) throw new HttpError(400, "Invalid signup source.");
    await service("newsletter_subscribe", { email, source, ip_hash, consent: true, consent_version: "elio-newsletter-v1" });
    // Do not reveal whether an email is pending, confirmed, suppressed, or unknown.
    return json({ accepted: true }, 200, headers);
  }
  if (action === "confirm" || action === "unsubscribe") {
    const value = field(input.token, "Email link", 64, true);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new HttpError(400, "This email link is invalid. Please request a new one.");
    const result = await service(`newsletter_${action}`, { token: value, ip_hash });
    return json({ status: result.status }, 200, headers);
  }
  throw new HttpError(400, "Unknown newsletter action.");
});

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (request.method === "GET" && url.searchParams.get("action") === "unsubscribe" && /^[a-f0-9]{64}$/.test(token)) {
    // Older mail clients may open the list header as a link. GET only opens the
    // explicit website control; link scanners never change subscription state.
    const destination = new URL("https://eliocheesecakes.com/newsletter.html");
    destination.hash = new URLSearchParams({ unsubscribe: token }).toString();
    return new Response(null, { status: 303, headers: { Location: destination.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  return handlePost(request);
}
