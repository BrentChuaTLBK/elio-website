# Order preparation slips

Open an order in the kitchen dashboard and choose **Print summary**, or select
orders and choose **Print selected**. Each order first tries to fit on one slip,
including its items, instructions, buyer/recipient details and payment breakdown.
Private staff notes do not print.

The layout first tries a quarter-sheet, then a compact quarter-sheet. Larger
orders use a half-sheet across the full landscape page width, with compact item
columns as needed. Each slip uses at most half a sheet. Only when an unusually
large order still cannot fit a compact half-sheet does it use extra, numbered
half-sheet slips. Every continuation repeats the order reference and buyer;
items/options and long instructions carry over without clipping. Quantities and
prices appear once per item, and the entire-order totals appear once on the last
slip. Keep every numbered slip with that order.

Choose A4 or Letter in the toolbar, then match that paper size in the browser
print dialog. Use landscape, actual size / 100%, and turn browser headers and
footers off. Changing paper remeasures the slips. A page holds up to four
quarter-sheet slips or two half-sheet slips; mixed sizes preserve order.

`tests/ui/slip-sizing.mjs` checks compact two-item orders, twelve-item half-sheet
orders, mixed batches, A4 and Letter bounds, totals, privacy, 100-item orders and
long option/instruction continuations.
`tests/ui/maintenance-and-print.mjs` also checks same-origin preview loading and
the existing maintenance flows. Browser tests create PDFs and screenshots; they
do not send jobs to a physical printer.
