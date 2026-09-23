// Category order controls the sections; products have a separate position in each.
const byPosition = (a,b) => (a.sort_order||0)-(b.sort_order||0) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));

export function productCategoryIds(product, categories) {
  const known = new Set(categories.map(category => category.id));
  const assigned = Array.isArray(product.category_ids) ? product.category_ids : [product.category_id];
  return [...new Set(assigned)].filter(id => typeof id === 'string' && known.has(id));
}

export function catalogProductGroups(products, categories) {
  const groups=[...categories].sort(byPosition).map(category=>({id:category.id,name:category.name,items:[]}));
  const uncategorized={id:'',name:'Uncategorized',items:[]};
  const byId=new Map(groups.map(group=>[group.id,group]));
  for (const product of products) {
    const ids=productCategoryIds(product,categories);
    if (!ids.length) uncategorized.items.push(product);
    else for (const id of ids) byId.get(id).items.push(product);
  }
  return [...groups,uncategorized].filter(group=>group.items.length).map(group=>({
    ...group,items:group.items.sort((a,b)=>
      (Number(a.category_sort_orders?.[group.id] ?? a.sort_order)||0)-(Number(b.category_sort_orders?.[group.id] ?? b.sort_order)||0)
      || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)))
  }));
}

// Admin lists keep one row per real product, even when it is in several sections.
export function orderedCatalogProducts(products,categories) {
  const seen=new Set();
  return catalogProductGroups(products,categories).flatMap(group=>group.items).filter(product=>{
    if (seen.has(product.id)) return false;
    seen.add(product.id);return true;
  });
}

export function sortProducts(products, category = '') {
  return [...products].sort((a,b) => (Number(category ? a.category_sort_orders?.[category] : a.sort_order)||0)-(Number(category ? b.category_sort_orders?.[category] : b.sort_order)||0) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}

export function categoryFields(product, categories, esc, disabled = '') {
  const ids=productCategoryIds(product,categories);
  return `<fieldset class="product-categories"><legend>Categories</legend><p class="help-text">Choose every category where this item should appear. It keeps one inventory record.</p>${categories.length ? categories.map(c=>`<label class="check-field"><input type="checkbox" name="category_ids" value="${esc(c.id)}" ${ids.includes(c.id)?'checked':''} ${disabled}><span>${esc(c.name)}</span></label>`).join('') : '<p class="muted">No categories yet. Add them with Arrange categories.</p>'}</fieldset>`;
}
