import { credentials, endpoint, field, HttpError, json, readBody, service, storageRequest, uuid, verifiedUser } from "../_shared/http.ts";
import { imageType, validateImage, MAX_IMAGE_BYTES } from "../_shared/images.ts";

export const handle = endpoint(async (request, headers) => {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data;")) throw new HttpError(400, "Send an image using a multipart form.");
  const bytes = await readBody(request, MAX_IMAGE_BYTES + 65536);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HttpError(400, "The upload form is invalid."); }
  const kind = field(form.get("kind"), "Upload type", 16, true);
  if (!["proof", "product", "pickup", "delivery"].includes(kind)) throw new HttpError(400, "Choose a supported photo upload type.");
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1) throw new HttpError(400, "Choose one image to upload.");
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Images must be 20 MB or smaller.");
  const contents = new Uint8Array(await file.arrayBuffer());
  const image = imageType(contents);
  const userId = await verifiedUser(request, kind === "product" || kind === "pickup");
  const orderId = kind === "product" ? null : uuid(form.get("order_id"));
  const token = field(form.get("token"), "Order access token", 256);
  const suppliedReference = form.get("payment_reference");
  if (suppliedReference !== null && typeof suppliedReference !== "string") throw new HttpError(400, "Payment reference must be text.");
  const paymentReference = field(suppliedReference, "Payment reference", 200);
  const authorization = await service(kind === "pickup" ? "authorize_pickup_upload" : kind === "delivery" ? "authorize_delivery_upload" : "authorize_upload", { kind, order_id: orderId, token, user_id: userId });
  if (!authorization?.allowed) throw new HttpError(403, "You cannot upload an image for this request.");
  await validateImage(contents);
  const bucket = kind === "pickup" ? "pickup-proofs" : kind === "delivery" ? "delivery-proofs" : kind === "proof" ? "payment-proofs" : "product-images";
  const path = `${orderId || userId}/${crypto.randomUUID()}.${image.extension}`;
  await storageRequest(`object/${bucket}/${path}`, "POST", contents, image.mime);
  if (kind === "product") {
    return json({ path, url: `${credentials().url}/storage/v1/object/public/${bucket}/${path}` }, 201, headers);
  }
  if (kind === "pickup" || kind === "delivery") {
    let saved;
    try {
      saved = kind === "pickup"
        ? await service("commit_pickup_proof", { order_id: orderId, user_id: userId, path, previous: authorization.previous })
        : await service("commit_delivery_receipt", { order_id: orderId, user_id: userId, token, path, payment_reference: paymentReference, quoted_at: authorization.quoted_at, fee_cents: authorization.fee_cents });
    } catch (error) {
      // A timed-out commit may already own this file. Only clean up a confirmed rejection.
      if (error instanceof HttpError && error.status === 400) {
        await storageRequest(`object/${bucket}`, "DELETE", JSON.stringify({ prefixes: [path] }), "application/json").catch(() => {});
      }
      throw error;
    }
    if (saved.previous && saved.previous !== path) {
      await storageRequest(`object/${bucket}`, "DELETE", JSON.stringify({ prefixes: [saved.previous] }), "application/json").catch(() => {});
    }
    return json({ saved: true }, 201, headers);
  }
  try {
    // Locks and validates the order again, closing the upload/expiry/rejection race.
    const order = await service("commit_proof", { order_id: orderId, token, user_id: userId, path, payment_reference: paymentReference });
    return json({ order }, 201, headers);
  } catch (error) {
    try { await storageRequest(`object/${bucket}`, "DELETE", JSON.stringify({ prefixes: [path] }), "application/json"); }
    catch { /* The object remains private if cleanup is temporarily unavailable. */ }
    throw error;
  }
});
