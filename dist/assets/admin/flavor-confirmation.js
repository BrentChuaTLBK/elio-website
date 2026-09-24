let nextId = 0;

// Keep the lineup/editor mounted so dismissing this dialog preserves its draft.
export function confirmFlavorRemoval({ heading, items, description, saveLabel = 'Save lineup' }, { parentDialog, returnFocus, document: doc = globalThis.document } = {}) {
  if (parentDialog && (!parentDialog.open || !parentDialog.isConnected)) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const originalFocus = returnFocus || doc.activeElement;
    const dialog = doc.createElement('dialog');
    const id = `flavor-confirmation-${++nextId}`;
    const make = (tag, className, text) => {
      const el = doc.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    dialog.className = 'flavor-confirmation';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-description`);
    const header = make('div', 'flavor-confirmation-header');
    const intro = make('div');
    intro.append(make('p', 'eyebrow', heading));
    const title = make('h2', '', 'Review lineup changes');
    title.id = `${id}-title`;
    intro.append(title);
    const close = make('button', 'flavor-confirmation-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close confirmation');
    header.append(intro, close);
    const body = make('div', 'flavor-confirmation-body');
    const explanation = make('p', 'flavor-confirmation-description', description);
    explanation.id = `${id}-description`;
    const affected = make('ul', 'flavor-confirmation-items');
    for (const item of items) {
      const row = make('li');
      row.append(make('h3', '', item.label));
      row.append(make('p', '', item.orders > 0
        ? `${item.orders} upcoming order${item.orders === 1 ? ' still needs' : 's still need'} ${item.pieces} piece${item.pieces === 1 ? '' : 's'}.`
        : 'No upcoming orders need this flavor.'));
      affected.append(row);
    }
    const preserved = make('div', 'flavor-confirmation-note');
    preserved.append(make('strong', '', 'Existing orders are kept'), make('p', '', 'Their flavor quantities will still appear in Production.'));
    body.append(explanation, affected, preserved);
    const actions = make('div', 'flavor-confirmation-actions');
    const cancel = make('button', 'button button-secondary', 'Keep editing');
    cancel.type = 'button';
    cancel.autofocus = true;
    const save = make('button', 'button', saveLabel);
    save.type = 'button';
    actions.append(cancel, save);
    dialog.append(header, body, actions);

    let settled = false;
    const listeners = [];
    const listen = (el, event, callback) => {
      el.addEventListener(event, callback);
      listeners.push(() => el.removeEventListener(event, callback));
    };
    const finish = (approved, error) => {
      if (settled) return;
      settled = true;
      const parentAvailable = !parentDialog || (parentDialog.open && parentDialog.isConnected);
      listeners.forEach(remove => remove());
      if (dialog.open) dialog.close();
      dialog.remove();
      // The surrounding submit handler re-enables controls after cancellation.
      doc.defaultView.requestAnimationFrame(() => {
        if (originalFocus?.isConnected && !originalFocus.disabled && !originalFocus.closest('[inert]')) originalFocus.focus({ preventScroll: true });
        else if (parentDialog?.open && !parentDialog.contains(doc.activeElement)) parentDialog.querySelector('button:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
      });
      if (error) reject(error);
      else resolve(approved === true && parentAvailable);
    };
    listen(cancel, 'click', () => finish(false));
    listen(close, 'click', () => finish(false));
    listen(save, 'click', () => finish(true));
    listen(dialog, 'cancel', event => { event.preventDefault(); finish(false); });
    listen(dialog, 'close', () => finish(false));
    if (parentDialog) listen(parentDialog, 'close', () => finish(false));
    try {
      doc.body.append(dialog);
      dialog.showModal();
      cancel.focus({ preventScroll: true });
    } catch (error) { finish(false, error); }
  });
}
