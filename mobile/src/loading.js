import {escapeHTML as h} from './core.js';

// Same phase survives app.innerHTML updates while real progress changes.
export function loading({label='正在加载',detail='',done=0,total=0,compact=false}={}) {
  const count=Number.isFinite(total)&&total>0?Math.floor(total):0;
  const value=Math.min(count,Math.max(0,Number(done)||0));
  return `<div class="shiye-loading ${compact?'is-compact':''}" role="status" aria-live="polite" style="--loading-phase:-${Date.now()%4200}ms"><span class="loading-art" aria-hidden="true"><span class="loading-morph"></span><svg viewBox="0 0 32 32" fill="none"><path d="M7 9c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V9Zm9 2v15" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M11 15h1m8 0h1" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg></span><span class="loading-copy"><strong>${h(label)}</strong>${detail?`<small>${h(detail)}</small>`:''}${count?`<span class="loading-meter"><progress max="${count}" value="${value}" aria-label="${h(label)}"></progress><small>${value} / ${count}</small></span>`:''}</span></div>`;
}

export function busy(label,detail='') {
  const element=document.createElement('div');element.className='busy-screen';element.innerHTML=loading({label,detail});document.body.append(element);
  return ()=>element.remove();
}
