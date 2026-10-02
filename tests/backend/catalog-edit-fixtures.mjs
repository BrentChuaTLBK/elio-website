// Existing contract fixtures model a fresh editor unless they explicitly pass
// expected_revision (including null). Concurrency tests use rawApi or an explicit
// captured revision; this helper must never refresh one supplied by a test.
export async function currentEditPayload(db, action, payload) {
  const tables = {save_product:['products','product'],save_promo:['promos','promo'],save_zone:['zones','zone'],save_category:['categories','category']};
  let row;
  if (action === 'save_settings') row = (await db.query('select data from elio.settings where id')).rows[0];
  else if (tables[action]) {
    const [table,key] = tables[action], id = payload[key]?.id;
    if (id) row = (await db.query(`select data from elio.${table} where id=$1`,[id])).rows[0];
  } else if (action === 'save_flavor_editor' && payload.id) row = (await db.query('select data from elio.products where id=$1',[payload.id])).rows[0];
  if (!row) return payload;
  const result = {...payload};
  if (!Object.hasOwn(result,'expected_revision')) result.expected_revision = row.data.edit_revision ?? 0;
  if (action === 'save_flavor_editor') {
    const rows = (await db.query("select (month=date_trunc('month',now() at time zone 'Asia/Manila')::date) as current, $1::uuid=any(flavor_ids) as selected from elio.flavor_menus where month between date_trunc('month',now() at time zone 'Asia/Manila')::date and (date_trunc('month',now() at time zone 'Asia/Manila')+interval '1 month')::date",[payload.id])).rows;
    for (const [key,current] of [['expected_current_month',true],['expected_next_month',false]]) if (!Object.hasOwn(result,key)) result[key] = rows.find(r=>r.current===current)?.selected ?? false;
  }
  return result;
}
