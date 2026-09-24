import {api,escapeHtml as esc,toast} from './client.js';

function draftFor(state) {
  return state.faqDraft ||= {content:structuredClone(state.faq_content || {heading:'Frequently asked questions',items:[]}),revision:state.faq_revision || 0,dirty:false};
}

export function faqView(state) {
  const draft=draftFor(state),locked=!state.connected||state.role!=='owner',disabled=locked?'disabled':'';
  return `<div class="view-heading"><div><p class="eyebrow">ELIO BASQUE CHEESECAKE</p><h1>FAQs</h1><p class="muted">Helpful answers for your Shop page.</p></div><button type="button" class="button" data-faq-action="add" ${disabled}>+ Add FAQ</button></div>
    ${locked?'<p class="notice">Only an owner can edit FAQs.</p>':''}
    <form id="faq-form"><div class="form-error" role="alert"></div><fieldset class="faq-fields" ${disabled}>
    <section class="panel"><label class="field">Section heading<input name="faq_heading" value="${esc(draft.content.heading)}" required maxlength="100"></label><p class="help-text">Shown above the FAQs on the Shop page.</p></section>
    <div class="faq-editor-list">${draft.content.items.map((item,index)=>`<section class="panel faq-editor" data-faq-id="${esc(item.id)}">
      <div class="section-heading"><h2>FAQ ${index+1}</h2><div class="row-actions"><button type="button" class="button button-quiet" data-faq-action="up" aria-label="Move FAQ ${index+1} up" ${index===0?'disabled':''}>↑</button><button type="button" class="button button-quiet" data-faq-action="down" aria-label="Move FAQ ${index+1} down" ${index===draft.content.items.length-1?'disabled':''}>↓</button><button type="button" class="button button-quiet" data-faq-action="remove">Remove</button></div></div>
      <label class="field">Question<input data-faq-field="question" value="${esc(item.question)}" required maxlength="200"></label>
      <label class="field">Answer<textarea data-faq-field="answer" rows="4" required maxlength="6000">${esc(item.answer)}</textarea></label>
      <details class="faq-link-fields" ${item.link_url?'open':''}><summary>Optional link</summary><div class="field-row"><label class="field">Link text<input data-faq-field="link_label" maxlength="120" value="${esc(item.link_label||'')}" placeholder="Explore our flavors"></label><label class="field">Link address<input data-faq-field="link_url" maxlength="2048" value="${esc(item.link_url||'')}" placeholder="https://… or flavors.html"></label></div></details>
      <label class="check-field"><input type="checkbox" data-faq-field="visible" ${item.visible?'checked':''}><span>Show this FAQ on the Shop page</span></label>
    </section>`).join('') || '<section class="panel empty-state"><h2>No FAQs yet</h2><p>Add your first question and answer. The FAQ section stays hidden while there are no visible questions.</p></section>'}</div>
    <div class="faq-save"><p data-faq-status role="status">${draft.dirty?'Unsaved changes. Save to update the Shop page.':'Changes appear on the Shop page after saving.'}</p><button type="button" class="button button-secondary" data-faq-action="reset" ${!draft.dirty?'disabled':''}>Reset edits</button><button type="submit" class="button" ${!draft.dirty?'disabled':''}>Save FAQs</button></div>
    </fieldset></form>`;
}

export function bindFaqView(state, root, render) {
  const form=root.querySelector('#faq-form');if (!form) return;
  const draft=draftFor(state);
  const editable=()=>state.connected&&state.role==='owner'&&!form.dataset.saving;
  const markDirty=()=>{draft.dirty=true;root.querySelector('[data-faq-status]').textContent='Unsaved changes. Save to update the Shop page.';form.querySelector('[type=submit]').disabled=false;form.querySelector('[data-faq-action=reset]').disabled=false;};
  form.addEventListener('input',event=>{
    if (!editable()) return;
    const input=event.target;
    if (input.name==='faq_heading') draft.content.heading=input.value;
    else if (input.dataset.faqField) {
      const item=draft.content.items.find(i=>i.id===input.closest('[data-faq-id]')?.dataset.faqId);
      if (!item) return;
      item[input.dataset.faqField]=input.type==='checkbox'?input.checked:input.value;
    } else return;
    markDirty();
  });
  for (const button of root.querySelectorAll('[data-faq-action]')) button.addEventListener('click',()=>{
    if (!editable()) return;
    const action=button.dataset.faqAction,id=button.closest('[data-faq-id]')?.dataset.faqId;
    const index=draft.content.items.findIndex(i=>i.id===id);
    if(action==='reset'){state.faqDraft=null;render();return;}
    if(action==='add') {
      if(draft.content.items.length>=50){toast('You can add up to 50 FAQs.');return;}
      draft.content.items.push({id:crypto.randomUUID(),question:'',answer:'',visible:true,link_label:'',link_url:''});
    } else if(action==='remove'&&index>=0) draft.content.items.splice(index,1);
    else if((action==='up'||action==='down')&&index>=0) {
      const to=index+(action==='up'?-1:1);if(to<0||to>=draft.content.items.length)return;
      [draft.content.items[index],draft.content.items[to]]=[draft.content.items[to],draft.content.items[index]];
    } else return;
    draft.dirty=true;render();
    if(action==='add')root.querySelector('.faq-editor:last-child [data-faq-field=question]')?.focus();
    else root.querySelector(`[data-faq-id="${id}"] [data-faq-action="${action}"]`)?.focus();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();if(!editable())return;
    form.dataset.saving='true';form.setAttribute('aria-busy','true');form.querySelector('fieldset').disabled=true;
    root.querySelector('[data-faq-action=add]').disabled=true;
    try {
      const result=await api('save_faqs',{content:draft.content,expected_revision:draft.revision});
      Object.assign(state,result);state.faqDraft=null;
      if(form.isConnected)render();toast('FAQs saved to your Shop page.');
    } catch(error) {form.querySelector('.form-error').textContent=error.message||'FAQs could not be saved. Your edits are still here.';}
    finally {delete form.dataset.saving;form.removeAttribute('aria-busy');form.querySelector('fieldset').disabled=false;const add=root.querySelector('[data-faq-action=add]');if(add)add.disabled=false;}
  });
}
