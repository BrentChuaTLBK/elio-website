import { credentials, endpoint, field, HttpError, json, readJson, service, storageRequest, uuid, verifiedUser } from "../_shared/http.ts";

export const handle = endpoint(async (request, headers) => {
  const body = await readJson(request);
  const pickup = body.kind === "pickup", delivery = body.kind === "delivery";
  const userId = await verifiedUser(request, !pickup);
  const orderId = uuid(body.order_id);
  const result = pickup
    ? await service("read_pickup_proof", { order_id: orderId, user_id: userId, token: field(body.token, "Order access token", 256) })
    : await service(delivery ? "read_delivery_receipt" : "authorize_proof_read", { order_id: orderId, user_id: userId });
  const path = result?.path;
  if (typeof path !== "string" || !path.startsWith(`${orderId}/`) || path.includes("..")) throw new HttpError(404, "This order has no available proof.");
  const bucket = pickup ? "pickup-proofs" : delivery ? "delivery-proofs" : "payment-proofs";
  const signed = await storageRequest(`object/sign/${bucket}/${path}`, "POST", JSON.stringify({ expiresIn: 300 }), "application/json");
  const signedPath = signed?.signedURL || signed?.signedUrl;
  if (typeof signedPath !== "string") throw new HttpError(502, "Could not open the private proof. Please try again.");
  const origin = new URL(credentials().url).origin;
  const url = new URL(signedPath.startsWith("/object/") ? "/storage/v1"+signedPath : signedPath, origin);
  if (url.origin !== origin || url.pathname !== "/storage/v1/object/sign/"+bucket+"/"+path) throw new HttpError(502, "The private proof could not be opened.");
  return json({ url: url.href, expires_in: 300 }, 200, headers);
});
