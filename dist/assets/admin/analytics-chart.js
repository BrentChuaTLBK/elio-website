// A shared tooltip sits outside the plot scroller so edge bars stay readable.
export function mountAnalyticsChart(container) {
 const root=container.querySelector('[data-sales-chart]');
 if(!root)return ()=>{};
 const controller=new AbortController(),options={signal:controller.signal};
 const scroller=root.querySelector('.analytics-chart-scroll'),tooltip=root.querySelector('[role=tooltip]');
 const points=[...root.querySelectorAll('.analytics-chart-point')];
 let active=null,pinned=null,dismissedFocus=null;
 const pointFor=target=>target instanceof Element?target.closest('.analytics-chart-point'):null;
 function position() {
  if(!active)return;
  const bounds=root.getBoundingClientRect(),visible=scroller.getBoundingClientRect(),point=active.getBoundingClientRect();
  if(point.right<=visible.left||point.left>=visible.right){tooltip.hidden=true;return;}
  tooltip.hidden=false;
  const bar=active.querySelector('.analytics-chart-bar').getBoundingClientRect();
  const left=Math.max(4,Math.min(point.left-bounds.left+point.width/2-tooltip.offsetWidth/2,bounds.width-tooltip.offsetWidth-4));
  tooltip.style.left=`${left}px`;
  tooltip.style.top=`${Math.max(4,bar.top-bounds.top-tooltip.offsetHeight-8)}px`;
 }
 function show(point) {
  if(!point||!root.contains(point))return;
  dismissedFocus=null;
  active?.classList.remove('is-active');active?.removeAttribute('aria-describedby');
  active=point;active.classList.add('is-active');active.setAttribute('aria-describedby',tooltip.id);
  tooltip.querySelector('[data-chart-period]').textContent=point.dataset.period;
  tooltip.querySelector('[data-chart-sales]').textContent=point.dataset.sales;
  tooltip.querySelector('[data-chart-orders]').textContent=point.dataset.orders;
  position();
 }
 function hide() {
  active?.classList.remove('is-active');active?.removeAttribute('aria-describedby');
  active=null;tooltip.hidden=true;
 }
 function unpin() {pinned?.setAttribute('aria-pressed','false');pinned=null;}
 function selectFocus(point) {points.forEach(item=>{item.tabIndex=item===point?0:-1;});}
 root.addEventListener('pointerover',event=>{if(event.pointerType!=='touch')show(pointFor(event.target));},options);
 root.addEventListener('pointerleave',()=>{
  const focused=pointFor(document.activeElement);
  if(pinned)show(pinned);else if(focused&&focused!==dismissedFocus&&root.contains(focused))show(focused);else hide();
 },options);
 root.addEventListener('focusin',event=>{const point=pointFor(event.target);if(point){selectFocus(point);show(point);}},options);
 root.addEventListener('focusout',event=>{if(!root.contains(event.relatedTarget)){if(pinned)show(pinned);else hide();}},options);
 root.addEventListener('click',event=>{
  const point=pointFor(event.target);if(!point)return;
  const same=pinned===point;unpin();
  if(same){dismissedFocus=point;hide();return;}
  pinned=point;pinned.setAttribute('aria-pressed','true');selectFocus(point);show(point);
 },options);
 root.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();dismissedFocus=pointFor(document.activeElement);unpin();hide();return;}
  const point=pointFor(event.target);if(!point)return;
  const index=points.indexOf(point),next=event.key==='ArrowRight'?index+1:event.key==='ArrowLeft'?index-1:event.key==='Home'?0:event.key==='End'?points.length-1:null;
  if(next===null)return;
  event.preventDefault();unpin();
  const target=points[Math.max(0,Math.min(next,points.length-1))];
  selectFocus(target);target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'});show(target);
 },options);
 document.addEventListener('pointerdown',event=>{if(!root.contains(event.target)){dismissedFocus=pointFor(document.activeElement);unpin();hide();}},options);
 scroller.addEventListener('scroll',position,options);
 const resize=new ResizeObserver(position);resize.observe(root);
 return ()=>{controller.abort();resize.disconnect();};
}
