export const readingMode=value=>value==='scroll'?'scroll':['slide','instant','horizontal'].includes(value)?'slide':'curl';
export function pageAtOffset(pages,offset){
  let index=0;for(let i=0;i<pages.length;i++){if(pages[i].start<=offset)index=i;else break;}return index;
}
// The pinned PageFlip renderer puts the folded sheet at startZIndex + 5.
// Its clipped soft-paper geometry stays untouched; only the paper back changes.
export function paperBackEffect(flip,host){
  let frame=0,active=false;
  const clear=()=>host.querySelectorAll('.paper-turning-back').forEach(el=>el.classList.remove('paper-turning-back'));
  const tick=()=>{
    if(!active)return;
    const z=flip.getSettings().startZIndex+5;
    host.querySelectorAll('.reader-page').forEach(el=>el.classList.toggle('paper-turning-back',el.style.display!=='none'&&Number(el.style.zIndex)===z&&!el.classList.contains('--simple')));
    frame=requestAnimationFrame(tick);
  };
  flip.on('changeState',event=>{
    active=event.data!=='read';cancelAnimationFrame(frame);
    if(active)frame=requestAnimationFrame(tick);else clear();
  });
  return()=>{active=false;cancelAnimationFrame(frame);clear();};
}
