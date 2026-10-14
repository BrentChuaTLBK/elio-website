// Compare editable values, including disabled fields and ordered photos. Buttons,
// file-picker state and validation/status markup are not part of a saved record.
export function formSnapshot(form, extra = null) {
  return JSON.stringify({fields:[...form.querySelectorAll('input[name],select[name],textarea[name]')]
    .filter(field=>!['file','submit','button','reset'].includes(field.type))
    .map(field=>[field.name,field.type==='checkbox'||field.type==='radio'?field.checked:field.multiple?[...field.selectedOptions].map(option=>option.value):field.value]),extra});
}

export function createEditorDraft({confirm, noun, extra=()=>null}) {
  let form=null,baseline=null,observer=null;
  const dirty=()=>Boolean(form?.isConnected&&baseline!==null&&formSnapshot(form,extra())!==baseline);
  const busy=()=>Boolean(form?.isConnected&&form.dataset.busy==='true');
  function sync(){
    if(!form?.isConnected)return;
    const changed=dirty(),working=busy(),status=form.querySelector('[data-draft-status]'),save=form.querySelector('[data-draft-save]');
    form.dataset.dirty=String(changed);
    const message=working?'Saving…':changed?'Unsaved changes':'No unsaved changes';
    if(status&&status.textContent!==message)status.textContent=message;
    if(save)save.disabled=working||Boolean(form.querySelector('button[type="submit"]')?.disabled);
  }
  function mount(next,{reset=false}={}){
    observer?.disconnect();form=next;
    if(reset||baseline===null)baseline=formSnapshot(form,extra());
    const bar=document.createElement('div');bar.className='editor-draft-bar';
    bar.innerHTML='<span role="status" aria-live="polite" data-draft-status></span><button type="button" class="button" data-draft-save>Save</button>';
    form.prepend(bar);
    bar.querySelector('button').addEventListener('click',()=>{
      const submit=form.querySelector('button[type="submit"]');
      if(submit&&!submit.disabled&&!busy())form.requestSubmit(submit);
    });
    for(const event of ['input','change','click'])form.addEventListener(event,()=>queueMicrotask(sync));
    observer=new MutationObserver(sync);observer.observe(form,{childList:true,subtree:true,attributes:true,attributeFilter:['data-busy']});sync();
  }
  async function canLeave(){
    if(busy())return false;
    if(!dirty())return true;
    return confirm(`Discard unsaved ${noun} changes?`,{title:'Unsaved changes',confirmLabel:'Discard changes',cancelLabel:'Keep editing'});
  }
  function clear(){observer?.disconnect();observer=null;form=null;baseline=null;}
  return {mount,dirty,busy,sync,canLeave,clear,get form(){return form;}};
}
