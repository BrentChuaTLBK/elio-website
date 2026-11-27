import { INSULATED_BAG_QUESTION_ID } from '../shop/box-questions.js';

const flavorGroup = label => /^(flavors?(?: per box)?|inside your box)$/i.test(label || '');
const insulatedQuestion = label => /\binsulated\b/i.test(label || '');
const packagingQuestion = label => /\b(packaging|pack|bag)\b/i.test(label || '');
const isFlavor = choice => choice.group_id ? choice.group_id === 'flavors' : flavorGroup(choice.group);

function normalizeLabel(value) {
  if (typeof value !== 'string') return value;
  const colon = value.indexOf(':');
  const group = value.slice(0, colon);
  if (colon < 0 || !(flavorGroup(group) || insulatedQuestion(group) || packagingQuestion(group))) return { label: value };
  const answer = value.slice(colon + 1).trim();
  const count = /^(\d+)\s*×\s*(.+)$/.exec(answer);
  return { group, label: count ? count[2] : answer, quantity: count ? Number(count[1]) : 1 };
}

function savedChoices(item, product) {
  if (item.selection_labels?.length) return item.selection_labels.map(normalizeLabel).filter(Boolean);
  return Object.entries(item.selections || {}).flatMap(([id, choices]) => {
    const group = product?.option_groups?.find(group => group.id === id);
    return Object.entries(choices || {}).filter(([, count]) => Number(count) > 0).map(([choiceId, quantity]) => ({
      group_id: id,
      group: group?.label || (id === 'flavors' ? 'Flavors per box' : id),
      label: group?.choices?.find(choice => choice.id === choiceId)?.label || choiceId,
      product_id: choiceId,
      quantity
    }));
  });
}

function insulation(choice) {
  const answer = choice.label || choice.name || '';
  const namedBag = /\binsulated bag\b/i.test(answer);
  const specificQuestion = choice.group_id === INSULATED_BAG_QUESTION_ID || insulatedQuestion(choice.group);
  if (specificQuestion && /^no\b/i.test(answer) || namedBag && /^(?:no|without)\b/i.test(answer)) return 'No';
  if (specificQuestion && /^yes\b/i.test(answer) || namedBag) return 'Yes';
  if ((specificQuestion || packagingQuestion(choice.group)) && /^paper bag\b/i.test(answer)) return 'No';
  return '';
}

const nameOf = choice => choice.label || choice.name || '';
const quantityOf = choice => Number(choice.quantity ?? choice.count ?? 1);
function asFlavor(choice) {
  return { name: nameOf(choice), quantity: quantityOf(choice), productId: choice.product_id, surcharge: Number(choice.surcharge_cents || 0) };
}

// Names, quantities and surcharges come from the order or quote. The catalog
// supplies images and helps read older orders that saved only choice IDs.
export function orderItemDetails(item, product) {
  const choices = savedChoices(item, product);
  const recipe = item.flavor_contents?.length ? item.flavor_contents : item.event_recipe || [];
  const isIncluded = choice => !choice.group_id && choice.group === 'Includes';
  const selected = choices.filter(choice => isFlavor(choice) || isIncluded(choice)).filter(choice => nameOf(choice));
  const flavors = recipe.length ? recipe.map(piece => {
    const match = selected.findIndex(choice => nameOf(choice) === nameOf(piece) && quantityOf(choice) === quantityOf(piece));
    const saved = match === -1 ? null : selected.splice(match, 1)[0];
    return asFlavor({ ...piece, surcharge_cents: saved?.surcharge_cents ?? piece.surcharge_cents });
  }) : selected.map(asFlavor);

  const preset = item.selections?.[INSULATED_BAG_QUESTION_ID];
  let insulated = Number(preset?.yes) === 1 ? 'Yes' : Number(preset?.no) === 1 ? 'No' :
    insulation(choices.find(choice => choice.group_id === INSULATED_BAG_QUESTION_ID) || {});
  const extras = [];
  for (const choice of choices) {
    if (isFlavor(choice) || isIncluded(choice)) continue;
    const answer = insulation(choice);
    if (answer) {
      insulated ||= answer;
      continue;
    }
    const name = nameOf(choice);
    if (name) extras.push([choice.group, flavorName({ name, quantity: quantityOf(choice) })].filter(Boolean).join(' · '));
  }
  return { flavors: flavors.filter(flavor => flavor.name && flavor.quantity > 0), insulated, extras };
}

export function flavorName({ name, quantity }) {
  return quantity > 1 ? quantity + ' × ' + name : name;
}

function thumbnail(flavor, products) {
  const product = (flavor.productId && products.find(item => item.id === flavor.productId)) ||
    products.find(item => item.kind === 'flavor' && item.name === flavor.name);
  const photo = product?.photos?.find(url => typeof url === 'string' && /^(https?:\/\/|assets\/|\/_immutable\/)/.test(url));
  return photo ? new URL(photo, new URL('../../', import.meta.url)).href : '';
}

export function renderOrderFlavors(flavors, { esc, money, products = [] }) {
  if (!flavors.length) return '';
  return '<ul class="order-flavors" aria-label="Flavors per box">' + flavors.map(flavor => {
    const photo = thumbnail(flavor, products);
    const extra = money && flavor.surcharge > 0 ? ' <span class="order-flavor-surcharge">+' + esc(money(flavor.surcharge)) + (flavor.quantity > 1 ? ' each' : '') + '</span>' : '';
    return '<li>' + (photo ? '<img class="order-flavor-icon" src="' + esc(photo) + '" alt="" referrerpolicy="no-referrer">' : '') +
      '<span>' + esc(flavorName(flavor)) + extra + '</span></li>';
  }).join('') + '</ul>';
}
