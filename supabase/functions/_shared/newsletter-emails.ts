import { emailFrame, emailIntro, emailButton, emailPanel, escapeEmail } from "./email-design.ts";

const e = escapeEmail;
const money = (cents: unknown) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(cents || 0) / 100);
const safeHttps = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value)) return "";
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : ""; } catch { return ""; }
};
const token = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : "";

export function renderNewsletterEmail(payload: any): { html: string; text: string } {
  const settings = payload?.settings || {};
  const siteValue = safeHttps(settings.site_url);
  if (!siteValue) throw new Error("A valid newsletter website URL is required.");
  const site = new URL(siteValue); site.hash = ""; site.search = ""; site.pathname = site.pathname.replace(/\/?$/, "/");
  const contact = settings.contact_email || "elio.cheesecakes@gmail.com";
  const address = String(settings.newsletter_mailing_address || settings.pickup_address || "").trim();
  if (!address) throw new Error("Newsletter mailing address is required.");
  const unsubscribeToken = token(payload.unsubscribe_token);
  const isBroadcast = payload.broadcast === true && payload.event_type === "newsletter_campaign";
  const unsubscribe = new URL("newsletter.html", site);
  unsubscribe.hash = new URLSearchParams({ unsubscribe: unsubscribeToken }).toString();
  const isPreview = payload.subscriber?.email === "preview@example.test" || payload.event_type === "newsletter_test_campaign";
  if (!unsubscribeToken && !isPreview && !isBroadcast) throw new Error("Newsletter unsubscribe link is missing.");
  const hero = new URL("assets/home-editorial-hero.webp", site).toString();
  let heading = "", intro = "", body = "", plain = "", subject = "";

  if (payload.event_type === "newsletter_confirmation") {
    const confirmationToken = token(payload.confirmation_token);
    if (!confirmationToken) throw new Error("Newsletter confirmation link is missing.");
    const confirm = new URL("newsletter.html", site);
    confirm.hash = new URLSearchParams({ confirm: confirmationToken }).toString();
    heading = "A little Elio, just for you.";
    subject = "Confirm your Elio newsletter subscription";
    intro = "Confirm your email for Elio news, special offers, exclusive promo codes, and your personal 5% welcome code.";
    const terms = "Minimum order ₱500. Maximum discount ₱100. One use per subscriber, valid for 14 days after confirmation. Sign in at checkout with this email address to use your code. Delivery is excluded; one promo code per order.";
    body = emailIntro("Elio Newsletter", heading, intro)
      + `<img src="${e(hero)}" width="656" alt="An individual Elio Basque cheesecake with a caramelized top" style="display:block;width:100%;height:auto;border:0;margin:22px 0">`
      + emailButton("Confirm subscription", confirm.toString())
      + `<p style="margin:0 0 18px;font-size:13px;color:#786858">This confirmation link is valid for 48 hours. Your discount code arrives in a separate email after you confirm.</p>`
      + emailPanel("Your welcome offer", `<p style="margin:0;font-size:13px;line-height:1.8">${e(terms)}</p>`)
      + `<p style="font-size:12px;color:#786858">If you did not request this, you can ignore this email. You will not receive newsletters unless you confirm.</p>`;
    plain = `${heading}\n\n${intro}\n\nConfirm your subscription:\n${confirm}\n\nLink expires in 48 hours.\n\n${terms}\n\nIf you did not request this, ignore this email.`;
  } else if (payload.event_type === "newsletter_welcome") {
    const offer = payload.offer;
    if (!offer?.code || !Number.isFinite(Date.parse(offer.expires_at))) throw new Error("Newsletter welcome offer is incomplete.");
    heading = "Your welcome treat.";
    subject = `Your ${Number(offer.value)}% Elio welcome code`;
    intro = "Welcome to the Elio Newsletter. Stay up to date with new flavors and seasonal collections, and enjoy special offers, discounts, and exclusive promo codes. Here’s a little thank-you for joining.";
    const expiry = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(offer.expires_at));
    const terms = `${Number(offer.value)}% off products with a minimum order of ${money(offer.min_subtotal_cents)}, up to ${money(offer.cap_cents)} off. Use once by ${expiry} (Manila time). Sign in using ${payload.subscriber.email} at checkout. Delivery is excluded. Cannot be combined with another promo code.`;
    const shop = new URL("order.html", site).toString();
    body = emailIntro("Welcome to the Elio Newsletter", heading, intro)
      + `<img src="${e(hero)}" width="656" alt="Elio square Basque cheesecake" style="display:block;width:100%;height:auto;border:0;margin:22px 0">`
      + emailPanel("A little something for your next box", `<p style="margin:0 0 10px;font:32px/1.2 Georgia,serif;color:#63412d">${e(offer.value)}% off</p><p style="margin:0 0 16px;font:bold 27px/1.4 Arial,sans-serif;letter-spacing:4px;color:#39251c">${e(offer.code)}</p><p style="margin:0;font-size:13px;line-height:1.8">${e(terms)}</p>`, "sand")
      + emailButton("Explore our boxes", shop);
    plain = `${heading}\n\n${intro}\n\nYour personal code: ${offer.code}\n\n${terms}\n\nExplore our boxes:\n${shop}`;
  } else if (payload.event_type === "newsletter_welcome_back") {
    heading = "Welcome back.";
    subject = "Welcome back to the Elio Newsletter";
    intro = "It’s lovely to have you back. You’re on the list again for new flavors, seasonal collections, special offers, and exclusive promo codes.";
    const shop = new URL("order.html", site).toString();
    body = emailIntro("Elio Newsletter", heading, intro)
      + `<img src="${e(hero)}" width="656" alt="Elio square Basque cheesecake" style="display:block;width:100%;height:auto;border:0;margin:22px 0">`
      + `<p style="margin:0 0 22px;font-size:15px;line-height:1.8;color:#665649">A little Elio in your inbox, and something delicious to look forward to.</p>`
      + emailButton("Discover what’s baking", shop);
    plain = `${heading}\n\n${intro}\n\nA little Elio in your inbox, and something delicious to look forward to.\n\nDiscover what’s baking:\n${shop}`;
  } else if (["newsletter_campaign", "newsletter_test_campaign"].includes(payload.event_type)) {
    const campaign = payload.campaign || {};
    heading = String(campaign.title || ""); subject = String(campaign.subject || "");
    if (!heading || !subject || !String(campaign.body || "").trim()) throw new Error("Newsletter content is incomplete.");
    const notes = String(campaign.body).split(/\n\s*\n/);
    const paragraphs = notes.map(p => `<p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#665649">${e(p).replace(/\n/g, "<br>")}</p>`).join("");
    const photo = safeHttps(campaign.image_url), cta = safeHttps(campaign.cta_url);
    if (campaign.image_url && !photo || campaign.cta_url && !cta) throw new Error("Newsletter links must use HTTPS.");
    const layout = campaign.template || 'spotlight';
    if (!['spotlight','offer','letter','editorial','invitation','digest'].includes(layout)) throw new Error("Choose a valid newsletter template.");
    const photoHtml = photo ? `<img src="${e(photo)}" alt="${e(heading)}" width="656" style="display:block;width:100%;height:auto;border:0;margin:0 0 24px">` : "";
    const button = cta && campaign.cta_label ? emailButton(String(campaign.cta_label), cta) : "";
    if (layout === 'offer') {
      body = `<div style="padding:30px 24px 12px;text-align:center;background:#f1e6d6;border:1px solid #d7bea0;margin:0 0 24px">${emailIntro("Exclusively for our subscribers", heading, "")}${paragraphs}${button}</div>` + photoHtml;
    } else if (layout === 'letter') {
      body = emailIntro("From the Elio kitchen", heading, "") + `<div style="border-top:1px solid #dfd1bd;padding-top:25px">${paragraphs}<p style="font:italic 21px/1.5 Georgia,serif;color:#63412d;margin:26px 0">With care,<br>The Elio team</p></div>` + button + photoHtml;
    } else if (layout === 'editorial') {
      const story = `<div style="overflow-wrap:anywhere;word-break:break-word">${emailIntro("The Elio edit", heading, "")}${paragraphs}${button}</div>`;
      body = photo ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed"><tr><td class="email-column" width="48%" valign="top" style="padding:0 28px 0 0"><img src="${e(photo)}" alt="${e(heading)}" width="288" style="display:block;width:100%;height:auto;border:0"><p style="margin:14px 0 0;border-top:1px solid #cdb38f;padding-top:12px;font:italic 18px/1.45 Georgia,serif;color:#8a6033">Burnt beautifully.<br>Soft within.</p></td><td class="email-column" width="52%" valign="top" style="overflow-wrap:anywhere;word-break:break-word">${story}</td></tr></table>` : story;
    } else if (layout === 'invitation') {
      body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #b68c58"><tr><td align="center" bgcolor="#f4ecdf" style="background:#f4ecdf;padding:30px 24px 12px;text-align:center;overflow-wrap:anywhere;word-break:break-word"><p style="margin:0 0 20px;font:22px/1 Georgia,serif;color:#91612f" aria-hidden="true">✦</p>${emailIntro("An invitation from Elio", heading, "")}${paragraphs}${button.replace('<table ', '<table align="center" ').replace('margin:22px 0 26px','margin:22px auto 26px')}</td></tr>${photo ? `<tr><td style="padding:12px"><img src="${e(photo)}" alt="${e(heading)}" width="630" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ''}</table>`;
    } else if (layout === 'digest') {
      body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin:0 0 8px"><tr><td class="email-column" valign="top" style="padding:0 ${photo ? '24px' : '0'} 0 0;overflow-wrap:anywhere;word-break:break-word">${emailIntro("The Elio brief", heading, "")}</td>${photo ? `<td class="email-column" width="144" valign="top"><img src="${e(photo)}" alt="${e(heading)}" width="144" style="display:block;width:144px;max-width:100%;height:auto;border:0"></td>` : ''}</tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${notes.map((note,index) => `<tr><td width="40" valign="top" style="border-top:1px solid #dfd1bd;padding:20px 12px 20px 0;font:22px/1.4 Georgia,serif;color:#91612f">${String(index + 1).padStart(2,'0')}</td><td valign="top" style="border-top:1px solid #dfd1bd;padding:20px 0;font:15px/1.8 Arial,sans-serif;color:#665649;overflow-wrap:anywhere;word-break:break-word">${e(note).replace(/\n/g,'<br>')}</td></tr>`).join('')}</table>${button}`;
    } else {
      body = photoHtml + emailIntro("The Elio collection", heading, "") + paragraphs + button;
    }
    plain = `${heading}\n\n${campaign.body}${cta ? `\n\n${campaign.cta_label || "Visit Elio"}:\n${cta}` : ""}`;
  } else { throw new Error("Unsupported newsletter email type."); }

  const unsubscribeUrl = isBroadcast ? "{{{RESEND_UNSUBSCRIBE_URL}}}" : unsubscribe.toString();
  const footer = `<p style="margin:26px 0 0;padding-top:20px;border-top:1px solid #dfd1bd;font-size:12px;line-height:1.8;color:#786858">${payload.event_type === "newsletter_confirmation" ? "You requested an Elio newsletter subscription." : "You’re receiving this because you subscribed to the Elio Newsletter."}<br>Elio Basque Cheesecake · ${e(address).replace(/\n/g, "<br>")}<br>${isPreview && !isBroadcast ? 'Email preview · unsubscribe links are disabled.' : `<a href="${e(unsubscribeUrl)}" style="color:#63412d;text-decoration:underline">Unsubscribe from Elio newsletters</a>`}</p>`;
  return { html: emailFrame(subject, intro || heading, body + footer, String(contact)), text: `${plain}\n\nElio Basque Cheesecake\n${address}\n${contact}\n${isPreview && !isBroadcast ? "Preview only." : `Unsubscribe from Elio newsletters:\n${unsubscribeUrl}`}` };
}

export function newsletterHeaders(payload: any, edgeBase: string): Record<string, string> {
  const value = token(payload?.unsubscribe_token);
  if (!value || payload?.event_type === "newsletter_test_campaign") return {};
  const url = new URL(`${edgeBase.replace(/\/$/, "")}/functions/v1/newsletter`);
  if (url.protocol !== "https:") throw new Error("A secure unsubscribe URL is required.");
  url.search = new URLSearchParams({ action: "unsubscribe", token: value }).toString();
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "List-Id": "Elio Newsletter <newsletter.eliocheesecakes.com>" };
}
