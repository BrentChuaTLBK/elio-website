// Enhance quantity inputs without replacing their form fields or save handlers.
const selector = 'input[data-quantity-stepper], #product-quantity';
const tracked = new WeakSet();

function sync(input) {
  const control = input.parentElement;
  if (!control?.classList.contains('quantity-stepper')) return;
  const value = input.value === '' ? null : Number(input.value);
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  const disabled = input.matches(':disabled') || input.readOnly;
  for (const button of control.querySelectorAll('[data-quantity-step]')) {
    const atLimit = value !== null && (button.dataset.quantityStep === '-1' ? value <= min : value >= max);
    if (button.disabled !== (disabled || atLimit)) button.disabled = disabled || atLimit;
  }
  const length = Math.max(3, Math.min(12, input.value.length || input.placeholder.length));
  control.style.setProperty('--quantity-value-width', `calc(${length}ch + 8px)`);
}

function enhance(input) {
  if (tracked.has(input)) { sync(input); return; }
  tracked.add(input);
  const label = input.getAttribute('aria-label') ||
    [...(input.labels?.[0]?.childNodes || [])].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim() || 'quantity';
  const control = document.createElement('span');
  control.className = 'quantity-stepper';
  input.before(control);
  for (const [delta, text, action] of [[-1, '−', 'Decrease'], [1, '+', 'Increase']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.quantityStep = String(delta);
    button.textContent = text;
    button.setAttribute('aria-label', `${action} ${label}`);
    button.addEventListener('click', () => {
      if (input.matches(':disabled') || input.readOnly) return;
      const before = input.value;
      if (delta > 0) input.stepUp(); else input.stepDown();
      if (input.value !== before) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sync(input);
    });
    control.append(button);
    if (delta === -1) control.append(input);
  }
  input.inputMode = 'numeric';
  input.addEventListener('input', () => sync(input));
  input.addEventListener('change', () => sync(input));
  sync(input);
}

function scan(root) {
  if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
  if (root.matches?.(selector)) enhance(root);
  root.querySelectorAll(selector).forEach(enhance);
}

scan(document);
new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'childList') record.addedNodes.forEach(scan);
    else scan(record.target);
  }
}).observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','min','max','value']});
