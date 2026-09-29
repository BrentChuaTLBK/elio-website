# Website photos

Owners open **Kitchen dashboard → Shop & team → Website photos** (or
`manage.html#website-photos`). The editor groups 14 independent placements by
Home page, Our Story, Shop, and Flavors page. This includes the gifting popup
and separate desktop/mobile Shop gifting images. Product images remain in
Flavors and Boxes & sets.

Choose a photo, review the preview, add its description and adjust the horizontal
or vertical crop position. **Save photo** publishes that placement. Uploads
accept JPEG, PNG, HEIC/HEIF and WebP, up to 20 MB. The existing local worker
converts them to WebP (maximum 2400-pixel longest edge, 5 MB result). No original
photo leaves the browser. Saving another page's image is independent.

**Restore original** selects the bundled original; **Save photo** publishes the
restoration. **Reload saved** discards that card's draft and retrieves the latest
published version. Leaving the editor warns about unsaved changes. Revision
checks prevent one owner from silently overwriting another owner's edits.
Successful saves appear on subsequent page loads without a code deployment.

The private `elio.website_photos` table stores an allowlisted slot, uploaded
Storage path, description, crop position and revision. RLS is enabled; direct
access and direct helper-function execution are revoked. `shop_api` exposes
`website_photos` as a small public read and `save_website_photo` as an owner-only
write. Both routes run before order housekeeping, so photo requests do not
expire orders or acquire the global ordering lock. Writes lock only their slot.

The public `website-images` bucket permits new WebP objects up to 5 MB; its
insert policy requires the current database owner role and the uploader's UUID
folder. Random new filenames avoid overwrites and stale image caches. Saves
verify that the object exists in that bucket and is marked as WebP. Old files
are retained, keeping previously loaded pages safe. They are not automatically
deleted when a slot is replaced or restored.

Public pages make one anonymous, uncached metadata request with a five-second
timeout. They keep their bundled originals if the request or replacement image
fails. Replacement images are checked before swapping. The Shop picture source
and its crop/description follow the mobile breakpoint, and dynamically created
gifting popups receive their saved image. Catalog images are unaffected.

The same release gives Home, Our Story, Shop and Flavors a shared brown-and-gold
footer with a brand signature, navigation, contact links, and separate legal row.

Validation: backend contract suite, real browser upload conversion and retry
checks, stale-save handling, original restoration, all public photo bindings,
responsive picture switching, outage fallbacks, and desktop/mobile layouts.
No live customer orders, inventory, email, or existing website photos are changed
by this feature's deployment.
