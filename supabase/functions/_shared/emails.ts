import { HttpError } from "./server.ts";
import { emailFrame, emailIntro, emailButton, emailSection, emailColumns, emailProducts, emailTotals } from "./email-design.ts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (value: unknown) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(Number(value || 0) / 100);
const date = (value: string, includeTime = false) => {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T12:00:00+08:00` : value);
  if (Number.isNaN(parsed.getTime())) return "See your order page";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", ...(includeTime ? { timeStyle: "short" as const } : {}) }).format(parsed) + (includeTime ? " (Asia/Manila)" : "");
};
const lines = (value: unknown) => escape(value).replace(/\n/g, "<br>");
const selectionParts = (item: any): string[] => (Array.isArray(item.selection_labels) && item.selection_labels.length ? item.selection_labels : (item.flavor_contents || []).map((f: any) => ({ label: f.name, quantity: f.quantity })))
  .map((choice: any) => typeof choice === "string" ? choice : `${choice.group ? `${choice.group}: ` : ""}${choice.label || "Option"}${choice.quantity ? ` × ${choice.quantity}` : ""}${Number(choice.surcharge_cents) ? ` (+${money(choice.surcharge_cents)} each)` : ""}`)
;
const selections = (item: any): string => selectionParts(item).join(", ");

function renderReviewEmail(order: any, settings: any, site: URL, photos: any): { html: string; text: string } {
  const link = new URL("manage.html", site).toString();
  const shop = settings.shop_name || "Elio Basque Cheesecake";
  const heading = "An order is ready for review";
  const message = "A customer has submitted payment proof. Sign in with your staff or owner account, open the order below, and review the proof before approving or rejecting payment.";
  // Legacy review messages may not have a saved item or payment breakdown.
  const detailed = Array.isArray(order.items) && ["subtotal_cents", "discount_cents", "delivery_cents", "total_cents"]
    .every(key => order[key] !== null && order[key] !== undefined && Number.isFinite(Number(order[key])));
  const items = detailed ? order.items : [];
  const details = `Order reference: ${order.reference}\nCustomer: ${order.buyer_name || "See the order in the dashboard"}\nFulfillment: ${date(order.fulfillment_date)} · ${order.method}${detailed ? "" : `\nOrder total: ${money(order.total_cents)}`}`;
  const discountLabel = `Discount${order.promo_code ? ` (${order.promo_code})` : ""}`;
  const discount = `${Number(order.discount_cents) > 0 ? "−" : ""}${money(order.discount_cents)}`;
  const itemText = items.map((item: any) => `${item.quantity} × ${item.name}${selections(item) ? `\n  ${selections(item)}` : ""}\n  ${money(item.unit_price_cents)} each · Line total: ${money(item.line_total_cents)}`).join("\n\n");
  const breakdown = detailed ? `\n\nProducts ordered\n${itemText || "See the product details in the dashboard."}\n\nPayment breakdown\nSubtotal: ${money(order.subtotal_cents)}\n${discountLabel}: ${discount}\nDelivery fee: ${money(order.delivery_cents)}\nOrder total: ${money(order.total_cents)}` : "";
  const footer = "You received this notification because your account is assigned a Staff or Owner role. The dashboard shows the current order status.";
  const text = `${shop}\n${heading}\n\n${message}\n\n${details}${breakdown}\n\nOpen the admin dashboard:\n${link}\n\n${footer}`;
  const reviewDetails = `<h2 style="margin:0 0 12px;font:normal 22px/1.3 Georgia,serif">Order details</h2><p style="margin:0;font-size:14px;line-height:1.8">${lines(details)}</p>`;
  const body = emailIntro("For the kitchen", heading, message, order.reference)
    + (items.length ? emailProducts(items, photos, site, selectionParts, money) : "")
    + emailColumns(reviewDetails, detailed ? emailTotals(order, money) : "")
    + emailButton("Open orders for review", link)
    + `<p style="margin:0;font-size:12px;line-height:1.7;color:#786858">${escape(footer)}</p>`;
  const html = emailFrame("Order ready for review", heading + " · " + order.reference, body);

  return { html, text };
}

export function renderEmail(payload: any): { html: string; text: string } {
  const order = payload?.order;
  const settings = { ...payload?.settings };
  // Preserve fulfillment and payment instructions saved with the submitted order.
  for (const key of ["payment_instructions", "pickup_address", "pickup_hours", "pickup_instructions", "delivery_window", "contact_email", "contact_phone"]) {
    if (order?.[key] !== undefined && order[key] !== null) settings[key] = order[key];
  }
  const review = payload?.event_type === "order_review_required";
  if (!order?.id || !order?.reference || (!review && !order?.access_token) || !settings?.site_url) {
    throw new HttpError(503, "Email configuration is incomplete: set the site URL and confirm the saved order access token.");
  }
  let site: URL;
  try { site = new URL(settings.site_url); } catch { throw new HttpError(503, "Configure a valid HTTPS site URL in Business settings."); }
  if (site.protocol !== "https:" || site.username || site.password) throw new HttpError(503, "Order emails require an HTTPS site URL.");
  site.search = "";
  site.hash = "";
  site.pathname = `${site.pathname.replace(/\/$/, "")}/`;
  if (review) return renderReviewEmail(order, settings, site, payload.product_photos);
  const access = new URL("order.html", site);
  access.hash = new URLSearchParams({ order: order.id, token: order.access_token }).toString();
  const link = access.toString();
  const contact = [settings.contact_email, settings.contact_phone].filter(Boolean).join(" · ");
  const reason = [...(order.history || [])].reverse().find((event: any) => event.reason && !event.private)?.reason || payload.reason || "See your order page for details.";
  let heading: string;
  let message: string;
  let instructions = "";
  switch (payload.event_type) {
    case "order_submitted":
      heading = "Your order has been received";
      message = "Your order is awaiting full initial payment and manual approval. Upload your proof of payment through the secure order link before the deadline. A payment reference is optional. Uploading proof places the payment under review; it does not confirm payment.";
      instructions = `Payment instructions:\n${settings.payment_instructions || "Open your order page for payment instructions."}\n\nPayment-proof deadline: ${date(order.payment_deadline, true)}.`;
      break;
    case "payment_approved":
      heading = "Payment approved · order confirmed";
      message = "Our team approved your full initial payment. Your order is confirmed for the fulfillment date below.";
      break;
    case "payment_rejected":
      heading = "Payment rejected · order cancelled";
      message = `Our team could not approve the initial payment. This order is now closed and cannot accept more proof. Reason: ${reason}`;
      instructions = "You may place a new order, which will be checked against current prices and availability, or contact us directly. If you already transferred funds, contact us about that payment before making any further payment.";
      break;
    case "order_cancelled":
      heading = "Your order has been cancelled";
      message = `Reason: ${reason}`;
      instructions = "Cancellation does not confirm a refund. Our team handles any refund directly with you; contact us with questions about an existing payment.";
      break;
    case "order_expired":
      heading = "Your payment-proof deadline has expired";
      message = "No payment proof was submitted before your payment-proof deadline. This order has expired and its unpaid reservations have been released. The order can no longer accept payment proof.";
      instructions = "Place a new order or contact us directly. If you already transferred funds, contact us about that payment before making any further payment.";
      break;
    case "fulfillment_reminder":
      heading = "Your order is scheduled for today";
      message = `Your paid order is scheduled for ${order.method === "delivery" ? "delivery" : "pickup"} today. This reminder does not change the order's fulfillment status.`;
      break;
    case "ready_for_pickup":
      heading = "Your order is ready for pickup";
      message = "Our team has marked your order ready for pickup. Please follow the pickup instructions below.";
      break;
    case "out_for_delivery":
      heading = "Your order is out for delivery";
      message = "Our team has marked your order out for delivery. An exact arrival time is not guaranteed. Contact us if you have questions.";
      break;
    default:
      heading = "Your order has been updated";
      message = "Our team updated your order. Open the secure order page to review the current details and history. For an order already paid, payment remains recorded and our team handles any difference directly with you.";
  }
  // Zone details belong to the saved order, not the zone's current configuration.
  const deliveryZone = [
    typeof order.delivery_zone_name === "string" && order.delivery_zone_name.trim() ? `Delivery zone: ${order.delivery_zone_name}` : "",
    typeof order.delivery_zone_description === "string" && order.delivery_zone_description.trim() ? order.delivery_zone_description : "",
  ].filter(Boolean).join("\n");
  const fulfillment = order.method === "delivery"
    ? [`Delivery window: ${settings.delivery_window || "See your order page"}. Arrival can be anytime within this window; no exact time is guaranteed.`, [order.recipient?.name, order.recipient?.phone, order.address?.line1, order.address?.line2, order.address?.locality, order.address?.postal_code].filter(Boolean).join("\n"), deliveryZone].filter(Boolean).join("\n")
    : [settings.pickup_address, settings.pickup_hours && `Opening hours: ${settings.pickup_hours}`, settings.pickup_instructions].filter(Boolean).join("\n");
  const items = Array.isArray(order.items) ? order.items : [];
  const itemText = items.map((item: any) => `${item.quantity} × ${item.name}${selections(item) ? ` (${selections(item)})` : ""} — ${money(item.line_total_cents)}`).join("\n");
  const totals = `Product subtotal: ${money(order.subtotal_cents)}\nDiscount: ${money(order.discount_cents)}\nDelivery fee: ${money(order.delivery_cents)}\nCurrent order total: ${money(order.total_cents)}`;
  const text = `${settings.shop_name || "Elio Basque Cheesecake"}\n${heading}\nOrder reference: ${order.reference}\n\n${message}\n\n${instructions ? `${instructions}\n\n` : ""}Fulfillment: ${date(order.fulfillment_date)} · ${order.method}\n${fulfillment}\n\n${itemText}\n\n${totals}\n\nView your order securely:\n${link}\n\nKeep this link private; it grants access to this order.\nThis is an automated update. Please use your order page to upload payment proof and check your status.\nFor changes, cancellations, or payment concerns, contact us${contact ? `: ${contact}` : " using the details on your order page"}.`;
  const detailTitle = order.method === "delivery" ? "Delivery details" : "Pickup details";
  const detailText = order.method === "delivery" ? fulfillment : [settings.pickup_address, settings.pickup_hours && `Opening hours: ${settings.pickup_hours}`].filter(Boolean).join("\n");
  const detailsHtml = `<h2 style="margin:0 0 12px;font:normal 22px/1.3 Georgia,serif">${detailTitle}</h2><p style="margin:0;font-size:13px;line-height:1.8">${lines(detailText || "See your order page for details.")}</p>`;
  const note = (value: string) => `<p style="margin:0;padding:16px 18px;background:#f4ecdf;font-size:13px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word">${lines(value)}</p>`;
  const body = emailIntro("Your Elio order", heading, message, order.reference)
    + `<p style="margin:0 0 22px;padding:14px 16px;background:#f4ecdf;font-size:14px;line-height:1.6;color:#63412d"><strong>${escape(date(order.fulfillment_date))}</strong> &nbsp; · &nbsp; ${order.method === "delivery" ? "Delivery" : "Pickup"}</p>`
    + (instructions ? emailSection(payload.event_type === "order_submitted" ? "Payment instructions" : "What happens next", note(instructions)) : "")
    + (items.length ? emailProducts(items, payload.product_photos, site, selectionParts, money) : "")
    + emailColumns(detailsHtml, emailTotals(order, money))
    + (order.method !== "delivery" && settings.pickup_instructions ? emailSection("Pickup notes", note(settings.pickup_instructions)) : "")
    + emailButton("View your order", link)
    + `<p style="margin:0 0 10px;text-align:center;font-size:11px;line-height:1.7;color:#786858">Keep this link private; it grants access to this order.</p><p style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#786858">This is an automated update. Please use your order page to upload payment proof and check your status.</p><p style="margin:0;font-size:12px;line-height:1.7;color:#786858">For changes, cancellations, or payment concerns, contact us${contact ? `: ${escape(contact)}` : " using the details on your order page"}.</p>`;
  const html = emailFrame("Your Elio order", heading + " · " + order.reference, body);

  return { html, text };
}
