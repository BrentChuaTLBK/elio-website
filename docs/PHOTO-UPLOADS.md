# Flavor popup details and product photos

Owners can edit the flavor name, tagline, brief description and photos under
**Flavors → Edit flavor**. The same record is available in **Flavor menus →
Edit flavor & placement**. A collapsed **Additional details (optional)** section
provides a details heading and size/box text. Both start blank and only appear in
the customer popup when filled in. The monthly status is derived from the lineup;
editing copy does not change stock or publication. The concept photography
disclaimer has been removed from the flavor popups.

New uploads in either editor accept JPEG, PNG, HEIC/HEIF and WebP, including
phone files that have a recognized extension but no MIME type. Source files can
be up to 20 MB and 60 megapixels. Files are decoded and re-encoded in a worker,
scaled proportionally to at most 2400 pixels on the longest edge, and saved as
WebP at quality 88. Smaller images are not enlarged; PNG transparency is retained.
The resulting file must be at most 5 MB and have a WebP MIME type and RIFF/WEBP
signature before it is uploaded to the existing owner-protected Storage bucket.
Multi-photo uploads run sequentially. Save the flavor or box to publish its
new photo URLs. Existing images and private payment proof uploads are unchanged.

Conversion normally uses browser image decoding and WebP encoding. Two pinned
dependencies are loaded only when needed:

- HEIC decoding: [heic-to 1.5.2](https://github.com/hoppergee/heic-to), LGPL-3.0,
  using its `dist/next/heic-to.js` worker build from jsDelivr.
- WebP encoding fallback: [@jsquash/webp 1.5.0](https://github.com/jamsinclair/jSquash/tree/main/packages/webp),
  Apache-2.0, from esm.sh with its matching encoder WASM from jsDelivr.

The CDN serves library code only. Photo bytes are processed locally and sent
only to Elio's Storage after successful conversion. A codec/network failure
shows an error; original JPEG/PNG/HEIC files are never uploaded as a fallback.
These code paths require a modern browser with module workers, ImageBitmap and
OffscreenCanvas support. Any future CSP must allow the pinned codec hosts,
their worker dependencies (`blob:`), and WASM compilation for the fallback.

Verified in browser QA: actual JPEG, transparent PNG, WebP and upstream libheif
HEIC fixtures; proportional resizing; missing MIME types; corrupt/spoofed image
rejection; forced non-native WebP encoding; both editor save flows; public popup
reflection and escaping; desktop and mobile layouts. Backend contract tests cover
owner authorization, text limits, shared persistence and unchanged stock/lineups.
