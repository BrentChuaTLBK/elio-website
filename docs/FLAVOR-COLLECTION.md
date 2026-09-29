# Flavor collection

The public Flavors page uses the compact photo-and-description layout approved in the B preview. It scrolls continuously, with two columns on desktop and one on smaller screens. Descriptions and optional size/serving details are fully visible; cards do not open a duplicate details popup.

- **This month** shows the current published menu and, when published, the next month's menu below it. Dates come from the existing public catalog response, including the December/January transition. Custom admin headings remain visible above the month titles. Preview sample dates and flavor selections are not production data.
- **Full collection** shows all publicly visible flavors. Current/next month badges help identify rotation. Search matches flavor names only, including partial matches and ignoring case/accents; descriptions, taglines and serving details are excluded. Search and taste filters work in both views and update each section's count.
- Existing `flavors.html#flavor-...` links reveal and focus that flavor in the appropriate list, including collection-only flavors. Published menu visibility is respected.
- The editable page and box photographs remain connected to Website photos. The introduction and box invitation are shorter, and the invitation stays below the lists.
- Uploaded product photos and placeholders continue to follow the catalog. Images load lazily. Cached tile lookups avoid a repeated scan through every card when filtering.

No schema, stock, menu publication, checkout or account changes are needed for this layout.

Validation: `tests/ui/flavor-list.mjs` exercises desktop/tablet/phone layouts, both published menus, unpublished and unavailable states, month rollover, keyboard tabs, old flavor links, category/search combinations, sorting and a 31-flavor collection with long/escaped text. Run with the existing `PLAYWRIGHT_PACKAGE_ROOT` and `BROWSER_EXECUTABLE_PATH` environment variables.
