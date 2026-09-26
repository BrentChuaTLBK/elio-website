// Table layouts and inline styles also work when a mail client strips the head.
export const escapeEmail = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const e = escapeEmail;
export const emailLines = (value: unknown) => e(value).replace(/\n/g, "<br>");

export function emailFrame(title: string, preview: string, content: string, contact = "elio.cheesecakes@gmail.com"): string {
 return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(title)}</title><style>
 @media only screen and (max-width:600px){.email-outer{padding:12px 8px!important}.email-content{padding:24px 20px!important}.email-column{display:block!important;width:100%!important;padding:0 0 22px!important}.email-column+.email-column{padding-top:0!important}.email-title{font-size:28px!important}.email-photo-cell{width:76px!important;padding-right:12px!important}.email-photo{width:64px!important}.email-product-name,.email-item-price{display:block!important;width:100%!important;text-align:left!important}.email-item-price{padding:0 0 9px!important;font-size:13px!important}.email-wordmark{font-size:42px!important}}
 </style></head><body style="margin:0;padding:0;background:#f5efe5;color:#39251c;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;-webkit-text-size-adjust:100%"><div lang="en" dir="ltr"><div style="display:none;font-size:1px;color:#f5efe5;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${e(preview)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="email-outer" align="center" style="padding:32px 16px"><!--[if mso]><table role="presentation" width="720"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:720px;background:#fffcf6;border:1px solid #dfd1bd"><tr><td align="center" bgcolor="#3d251c" style="background:#3d251c;padding:27px 20px 24px;border-bottom:3px solid #b68c58"><a href="https://eliocheesecakes.com" style="color:#ddb57d;text-decoration:none"><span class="email-wordmark" style="display:block;font:48px/1.05 Georgia,'Times New Roman',serif;letter-spacing:5px">ELIO</span><span style="display:block;margin-top:7px;font:10px/1.6 Georgia,serif;letter-spacing:2.5px">BASQUE CHEESECAKE</span><span style="display:block;margin-top:4px;font:italic 10px/1.5 Georgia,serif;color:#dfc5a2">by TLB Kitchen</span></a></td></tr><tr><td class="email-content" style="padding:32px;color:#39251c">${content}</td></tr><tr><td align="center" style="padding:22px 24px;border-top:1px solid #dfd1bd;background:#f4ecdf"><p style="margin:0 0 10px;font:20px/1.4 Georgia,serif;color:#63412d">Burnt beautifully. Soft within.</p><p style="margin:0;font:12px/1.8 Arial,sans-serif;color:#786858">Elio Basque Cheesecake<br><a href="mailto:${e(contact)}" style="color:#63412d;text-decoration:underline">${e(contact)}</a></p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></div></body></html>`;
}

export function emailIntro(eyebrow: string, heading: string, message: string, reference = ""): string {
 return `<p style="margin:0 0 14px;font:11px/1.6 Arial,sans-serif;letter-spacing:1.8px;text-transform:uppercase;color:#8a6033">${e(eyebrow)}</p><h1 class="email-title" style="margin:0 0 18px;font:normal 34px/1.2 Georgia,'Times New Roman',serif;color:#39251c">${e(heading)}</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.75;color:#665649">${e(message)}</p>${reference ? `<p style="margin:0 0 6px;font-size:14px;color:#8a6033">Order <strong style="letter-spacing:1px">${e(reference)}</strong></p>` : ""}`;
}

export function emailButton(label: string, href: string): string {
 return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 26px"><tr><td align="center" bgcolor="#91612f" style="background:#91612f;border:1px solid #91612f;mso-padding-alt:14px 26px"><a href="${e(href)}" style="display:inline-block;padding:14px 26px;font:bold 14px/20px Arial,sans-serif;color:#ffffff;text-decoration:none;mso-padding-alt:0">${e(label)} &nbsp; →</a></td></tr></table>`;
}

export function emailSection(title: string, content: string): string {
 return `<section style="margin:24px 0 0"><h2 style="margin:0 0 12px;font:normal 22px/1.3 Georgia,serif;color:#39251c">${e(title)}</h2>${content}</section>`;
}

export function emailColumns(left: string, right: string): string {
 return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;table-layout:fixed"><tr><td class="email-column" width="55%" valign="top" style="padding:0 22px 0 0;overflow-wrap:anywhere;word-break:break-word">${left}</td><td class="email-column" width="45%" valign="top" style="padding:0;overflow-wrap:anywhere;word-break:break-word">${right}</td></tr></table>`;
}

export function emailPanel(title: string, content: string, tone: "cream" | "sand" = "cream"): string {
 const bg = tone === "sand" ? "#eee3d0" : "#f4ecdf";
 return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 20px"><tr><td bgcolor="${bg}" style="padding:20px;border-radius:6px;overflow-wrap:anywhere;word-break:break-word"><h2 style="margin:0 0 16px;font:normal 23px/1.3 Georgia,serif;color:#39251c">${e(title)}</h2>${content}</td></tr></table>`;
}

export function productPhoto(item: any, photos: any, site: URL): string {
 const value = photos?.[item.product_id];
 if (typeof value !== "string" || !/^(https:\/\/|assets\/)/.test(value)) return "";
 try { const url = new URL(value, site); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : ""; } catch { return ""; }
}

export function emailProducts(items: any[], photos: any, site: URL, labels: (item: any) => string[], money: (value: unknown) => string): string {
 return `<h2 style="margin:0 0 18px;font:normal 23px/1.3 Georgia,serif;color:#39251c">Inside your order</h2>${items.map(item => {
  const photo = productPhoto(item, photos, site), parts = labels(item);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-bottom:1px solid #dfd1bd"><tr>${photo ? `<td class="email-photo-cell" width="82" valign="top" style="width:82px;padding:0 14px 18px 0"><img class="email-photo" src="${e(photo)}" width="68" alt="${e(item.name)}" style="display:block;width:68px;max-width:100%;height:auto;border:0;border-radius:5px;background:#f4ecdf"></td>` : ""}<td valign="top" style="padding:0 0 18px;overflow-wrap:anywhere;word-break:break-word"><h3 style="margin:0 0 8px;font:bold 15px/1.5 Arial,sans-serif;color:#39251c">${e(item.quantity)} × ${e(item.name)}</h3>${parts.map(label => `<span style="display:inline-block;max-width:100%;margin:0 4px 4px 0;padding:3px 6px;background:#f2eadc;border:1px solid #e7dac5;border-radius:3px;font:12px/1.5 Arial,sans-serif;color:#63412d">${e(label)}</span>`).join("")}${parts.length ? '<p style="margin:2px 0 8px;font-size:11px;line-height:1.5;color:#786858">In each box</p>' : ""}<p style="margin:0 0 4px;font:12px/1.6 Arial,sans-serif;color:#786858">${e(money(item.unit_price_cents))} per box</p><p style="margin:0;font:bold 15px/1.5 Arial,sans-serif;color:#39251c">${e(money(item.line_total_cents ?? item.quantity * item.unit_price_cents))}</p></td></tr></table>`;
 }).join("")}`;
}

export function emailTotals(order: any, money: (value: unknown) => string): string {
 const discount = `${Number(order.discount_cents) > 0 ? "−" : ""}${money(order.discount_cents)}`;
 return emailPanel("Payment summary", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:1.65"><tr><td style="padding:3px 8px 3px 0">Products</td><td align="right">${e(money(order.subtotal_cents))}</td></tr><tr><td style="padding:3px 8px 3px 0">Discount${order.promo_code ? ` (${e(order.promo_code)})` : ""}</td><td align="right">${e(discount)}</td></tr><tr><td style="padding:3px 8px 10px 0">${order.method === "pickup" ? "Pickup" : "Delivery"}</td><td align="right" style="padding-bottom:10px">${e(money(order.delivery_cents))}</td></tr><tr><td style="padding-top:12px;border-top:1px solid #dfd1bd;font-weight:bold">Order total</td><td align="right" style="padding-top:12px;border-top:1px solid #dfd1bd;font-weight:bold;font-size:18px;color:#63412d;white-space:nowrap">${e(money(order.total_cents))}</td></tr></table>`);
}
