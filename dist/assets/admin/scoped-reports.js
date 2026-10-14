// The database aggregates complete matching history. Keep presentation sorting
// in the browser so names use the same locale ordering as the original reports.
export function normalizeAnalytics(report){
  report.promoCodes.sort((a,b)=>b.orderCount-a.orderCount||b.discountCents-a.discountCents||a.code.localeCompare(b.code));
  report.topProducts.sort((a,b)=>b.units-a.units||b.lineValueCents-a.lineValueCents||String(a.name).localeCompare(String(b.name))||a.productId.localeCompare(b.productId));
  report.topFlavors.sort((a,b)=>b.pieces-a.pieces||a.name.localeCompare(b.name)||a.flavorId.localeCompare(b.flavorId));
  return report;
}
export function normalizeProduction(report){
  const normalize=group=>{
    group.flavors.sort((a,b)=>a.name.localeCompare(b.name));
    group.sets=group.sets.map(({combination_parts:parts,...row})=>({...row,combination:row.kind==='Custom box'?(parts||[]).sort((a,b)=>a.name.localeCompare(b.name)).map(part=>`${part.quantity} × ${part.name}`).join(' · ')||'Recipe needs review':''}));
    group.sets.sort((a,b)=>a.name.localeCompare(b.name)||a.combination.localeCompare(b.combination));
    return group;
  };
  normalize(report);report.days=report.days.map(normalize).sort((a,b)=>a.date.localeCompare(b.date));return report;
}
