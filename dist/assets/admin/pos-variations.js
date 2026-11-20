// Basket lines store selections for one unit. Fill each unit from the chosen
// totals in display order, then combine units with the same selections.
export function posItemVariations(groups, quantity, selections) {
 if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
  throw new Error('Enter a whole quantity from 1 to 10000.');
 }
 if (!groups.length) return [{ quantity, selections: {} }];
 const pools = groups.map(group => {
  const choices = group.choices.filter(choice => choice.active !== false).map(choice => ({
   id: choice.id, remaining: selections[group.id]?.[choice.id] ?? 0
  }));
  const expected = group.required_count * quantity;
  if (choices.some(choice => !Number.isInteger(choice.remaining) || choice.remaining < 0)
      || choices.reduce((sum, choice) => sum + choice.remaining, 0) !== expected) {
   throw new Error(`Choose exactly ${expected} for ${group.label}.`);
  }
  return { id: group.id, required: group.required_count, choices, index: 0 };
 });
 const variations = new Map();
 for (let unit = 0; unit < quantity; unit++) {
  const combination = Object.fromEntries(pools.map(pool => {
   const selected = [];
   let needed = pool.required;
   while (needed > 0) {
    const choice = pool.choices[pool.index];
    const take = Math.min(choice.remaining, needed);
    if (take) selected.push([choice.id, take]);
    choice.remaining -= take;
    needed -= take;
    if (!choice.remaining) pool.index++;
   }
   return [pool.id, Object.fromEntries(selected)];
  }));
  const key = JSON.stringify(combination);
  const existing = variations.get(key);
  if (existing) existing.quantity++;
  else variations.set(key, { quantity: 1, selections: combination });
 }
 return [...variations.values()];
}
