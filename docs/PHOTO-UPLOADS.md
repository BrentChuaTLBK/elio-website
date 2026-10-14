# Photos and receipt uploads

Owners can edit the flavor name, tagline, brief description and photos under
**Flavors → Edit flavor**. The same record is available in **Flavor menus →
Edit flavor & placement**. A collapsed **Additional details (optional)** section
provides a details heading and size/box text. Both start blank and only appear in
the customer popup when filled in. The monthly status is derived from the lineup;
editing copy does not change stock or publication. The concept photography
disclaimer has been removed from the flavor popups.

New uploads across flavor/box editors, newsletters, customer payment proofs and
affiliate payment receipts accept JPEG, PNG, HEIC/HEIF and WebP, including
phone files that have a recognized extension but no MIME type. Source files can
be up to 20 MiB (20,971,520 bytes) and 60 megapixels. The browser first tries to decode and re-encode them in a worker,
scale proportionally, and save as WebP. Product/newsletter photos use at most
2400 pixels on the longest edge and quality 88; payment receipts use at most
3200 pixels and quality 94 to preserve small text. Smaller images are not
enlarged; PNG transparency is retained.
Successful WebP conversion results are limited to 5 MiB and checked for their MIME type and RIFF/WEBP
signature. If conversion fails, times out or produces an oversized result, a structurally validated original retains its recognized MIME type and extension and may be uploaded up to the 20 MiB limit. Storage buckets and upload endpoints accept that same original-file limit.
Multi-photo uploads run sequentially. Save the flavor or box to publish its
new photo URLs. Existing stored images and receipts are unchanged. Private
receipts still use their existing private buckets and authorization rules.
Converted results are cached per file and purpose, so retrying a payout uses
identical bytes and preserves its idempotency fingerprint. Conversion failures
clear the cache so a retry can recover. PDFs remain unsupported.

Receipt and product-upload Edge Functions validate file structure before writing Storage or changing an order/payout. Structural checks include PNG chunk CRCs, JPEG frame dimensions, bounded HEIC containers and the 60-megapixel limit where dimensions are available. Supported non-HEIC files up to 12 megapixels are also decoded with pinned `@imagemagick/magick-wasm` 0.0.43 (Apache-2.0), with bounded memory and a single frame. Damaged decoded pixel data returns 415. HEIC and larger originals avoid that decoded-pixel allocation; structurally valid PNG/JPEG originals also remain accepted if the decoder is unavailable. WebP still requires its decoder. The browser receipt conversion limit is 3200px. Install the pinned development dependency with `npm ci` to run the actual decoder in local endpoint tests.

Conversion normally uses browser image decoding and WebP encoding. Two pinned
dependencies are loaded only when needed:

- HEIC decoding: [heic-to 1.5.2](https://github.com/hoppergee/heic-to), LGPL-3.0,
  using its `dist/next/heic-to.js` worker build from jsDelivr.
- WebP encoding fallback: [@jsquash/webp 1.5.0](https://github.com/jamsinclair/jSquash/tree/main/packages/webp),
  Apache-2.0, from esm.sh with its matching encoder WASM from jsDelivr.

The CDN serves library code only. Photo bytes are processed locally and sent
only to Elio's Storage. A codec/network failure uses the validated original fallback described above; an invalid original remains rejected.
These code paths require a modern browser with module workers, ImageBitmap and
OffscreenCanvas support. Any future CSP must allow the pinned codec hosts,
their worker dependencies (`blob:`), and WASM compilation for the fallback.

Verified in browser QA: actual JPEG, transparent PNG, WebP and upstream libheif
HEIC fixtures; proportional resizing; missing MIME types; corrupt/spoofed image
rejection; forced non-native WebP encoding; both editor save flows; public popup
reflection and escaping; desktop and mobile layouts; customer and affiliate
receipt conversion, retry fingerprints, and the higher receipt resolution.
Backend contract tests cover
owner authorization, text limits, shared persistence and unchanged stock/lineups.

Manual and automatic order-proof backups accept the same 20 MiB original bytes. The backup container partitions those proofs into bounded ZIP parts; see [order-backup.md](order-backup.md). Shared request-body overflow errors are generic because the same helper also protects small JSON requests; image-specific size errors remain at the upload endpoints.
