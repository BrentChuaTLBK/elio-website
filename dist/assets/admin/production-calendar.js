import { calendarMonthDays, calendarKeyDate, shiftCalendarMonth } from './date-calendar.js';

const dateLabel = date => new Intl.DateTimeFormat('en', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
const monthLabel = month => new Intl.DateTimeFormat('en', {month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function view({from, to, mode, month, today, selecting, focusDate}) {
  const single = mode === 'single';
  const instruction = single ? 'Choose one pickup / delivery date.' : selecting === 'end'
    ? 'Choose the last date. Select the same date again for a single-day report.'
    : 'Choose the first date, then the last. Both dates are included.';
  const months = [month,shiftCalendarMonth(month,1)];
  const focus = focusDate || (from?.startsWith(month) ? from : `${month}-01`);
  return `<div class="production-picker-top"><span class="eyebrow">Pickup / delivery dates</span><div class="production-picker-modes" role="group" aria-label="Date selection mode"><button type="button" data-range-mode="range" aria-pressed="${!single}">Date range</button><button type="button" data-range-mode="single" aria-pressed="${single}">Single date</button></div></div>
    <div class="production-picker-dates ${single?'single':''}"><button type="button" data-range-endpoint="start" aria-pressed="${selecting==='start'}"><span>${single?'Selected date':'From'}</span><strong>${from?dateLabel(from):'Choose a date'}</strong></button>${single?'':`<span class="production-picker-arrow" aria-hidden="true">→</span><button type="button" data-range-endpoint="end" aria-pressed="${selecting==='end'}"><span>Through · included</span><strong>${to?dateLabel(to):'Choose end date'}</strong></button>`}</div>
    <p class="production-picker-hint" aria-live="polite">${instruction}</p>
    <div class="production-picker-navigation"><button type="button" data-range-move="-1" aria-label="Previous month">‹</button><button type="button" data-range-today>Current month</button><button type="button" data-range-move="1" aria-label="Next month">›</button></div>
    <div class="production-picker-months">${months.map((m,index)=>{
      const cells=calendarMonthDays(m),rows=[];
      for(let n=0;n<cells.length;n+=7)rows.push(`<tr>${cells.slice(n,n+7).map(date=>{
        if(!date)return '<td></td>';
        const start=date===from,end=date===to,inRange=!!from&&!!to&&date>=from&&date<=to;
        return `<td class="${inRange?'in-range ':''}${start?'range-start ':''}${end?'range-end':''}"><button type="button" data-range-date="${date}" tabindex="${date===focus?0:-1}" aria-label="${dateLabel(date)}${start?', range start':''}${end?', range end':''}" aria-pressed="${inRange||start}" ${date===today?'aria-current="date"':''}>${Number(date.slice(8))}</button></td>`;
      }).join('')}</tr>`);
      return `<table class="production-picker-month" data-range-month="${m}" aria-label="${monthLabel(m)}"><caption>${monthLabel(m)}</caption><thead><tr>${weekdays.map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    }).join('')}</div>`;
}

export function productionCalendar(range,today,mode='range') {
  const state={...range,today,mode,month:range.from.slice(0,7),selecting:'start'};
  return `<div class="production-picker" data-production-picker data-mode="${mode}" data-month="${state.month}" data-today="${today}" data-selecting="start"><input type="hidden" name="from" value="${range.from}"><input type="hidden" name="to" value="${range.to}"><div data-production-calendar-view>${view(state)}</div></div>`;
}

export function bindProductionCalendar(root) {
  const stateFor = picker => ({from:picker.querySelector('[name=from]').value,to:picker.querySelector('[name=to]').value,...picker.dataset});
  const render = (picker,state,{focusDate,focusSelector}={}) => {
    const form=picker.closest('form');
    picker.querySelector('[name=from]').value=state.from;
    picker.querySelector('[name=to]').value=state.to;
    for(const key of ['mode','month','selecting'])picker.dataset[key]=state[key];
    picker.querySelector('[data-production-calendar-view]').innerHTML=view({...state,focusDate});
    const submit=form.querySelector('[type=submit]');
    submit.disabled=!state.from||!state.to;
    form.querySelector('.form-error').textContent='';
    if(focusDate)picker.querySelector(`[data-range-date="${focusDate}"]`)?.focus({preventScroll:true});
    else if(focusSelector)picker.querySelector(focusSelector)?.focus({preventScroll:true});
  };
  root.addEventListener('click',event=>{
    const button=event.target.closest('button'),picker=button?.closest('[data-production-picker]');
    if(!picker||!root.contains(picker)||button.disabled)return;
    const state=stateFor(picker),date=button.dataset.rangeDate;
    if(date){
      if(state.mode==='single'){state.from=date;state.to=date;state.selecting='start';}
      else if(state.selecting==='start'||!state.from||date<state.from){state.from=date;state.to='';state.selecting='end';}
      else {state.to=date;state.selecting='start';}
      render(picker,state,{focusDate:date});
    } else if(button.dataset.rangeMode){
      state.mode=button.dataset.rangeMode;
      if(state.mode==='single')state.to=state.from||state.today;
      if(!state.from)state.from=state.today;
      state.selecting=state.mode==='range'&&!state.to?'end':'start';
      state.month=state.from.slice(0,7);
      render(picker,state,{focusSelector:`[data-range-mode="${state.mode}"]`});
    } else if(button.dataset.rangeEndpoint){
      state.selecting=button.dataset.rangeEndpoint;
      state.month=(state.selecting==='end'?(state.to||state.from):state.from).slice(0,7);
      render(picker,state,{focusDate:state.selecting==='end'?(state.to||state.from):state.from});
    } else if(button.dataset.rangeMove){
      state.month=shiftCalendarMonth(state.month,Number(button.dataset.rangeMove));
      render(picker,state,{focusSelector:`[data-range-move="${button.dataset.rangeMove}"]`});
    } else if(button.hasAttribute('data-range-today')){
      state.month=state.today.slice(0,7);render(picker,state,{focusDate:state.today});
    }
  });
  root.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-range-date]'),picker=button?.closest('[data-production-picker]');
    if(!picker||!root.contains(picker))return;
    const date=calendarKeyDate(button.dataset.rangeDate,event.key,event.shiftKey);
    if(!date)return;
    event.preventDefault();
    const state=stateFor(picker),target=picker.querySelector(`[data-range-date="${date}"]`);
    if(!target||!target.getClientRects().length)state.month=date.slice(0,7);
    render(picker,state,{focusDate:date});
  });
}
