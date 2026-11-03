import {PageFlip} from 'page-flip';
import {getText,saveProgress,getSetting,setSetting} from './storage.js';
import {splitChapters,chapterAt,escapeHTML} from './core.js';
import {readingMode,pageAtOffset,paperBackEffect} from './reader-effects.js';

export const THEMES=[
  {id:'paper',name:'米色',background:'#f5f1e8',ink:'#242522'},
  {id:'white',name:'默认',background:'#ffffff',ink:'#242522'},
  {id:'green',name:'浅绿',background:'#e0eee1',ink:'#242b26'},
  {id:'blue',name:'浅蓝',background:'#dcebef',ink:'#253039'},
  {id:'yellow',name:'浅黄',background:'#efe2c0',ink:'#352f25'},
  {id:'night',name:'深夜',background:'#191919',ink:'#b8b5ac'}
];
const MODES=[['curl','仿真','卷曲纸张'],['slide','左右滑动','整页横向'],['scroll','上下滑动','连续阅读']];
export class Reader{
  constructor({onClose,onError}){this.onClose=onClose;this.onError=onError;this.offset=0;this.generation=0;}
  async open(book){
    this.book=book;this.text=await getText(book.id);
    if(!this.text)throw new Error('这本书的正文未保存在本机，请重新下载或导入');
    this.chapters=splitChapters(this.text);this.offset=Math.min(book.offset||0,this.text.length-1);
    this.settings={fontSize:20,lineHeight:1.9,theme:'paper',font:'serif',mode:'curl',...(await getSetting('reader'))};
    this.settings.mode=readingMode(this.settings.mode);this.mount();await document.fonts.ready;await this.layout();
    this.keyHandler=e=>{if(e.target.closest('input,select,textarea')||e.key===' '&&e.target.closest('button'))return;if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();this.next();}if(e.key==='ArrowLeft'){e.preventDefault();this.prev();}if(e.key==='Escape')this.close();};
    this.resizeHandler=()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.layout().catch(this.onError),180);};
    this.hideHandler=()=>this.persist();document.addEventListener('keydown',this.keyHandler);window.addEventListener('resize',this.resizeHandler);document.addEventListener('visibilitychange',this.hideHandler);
  }
  mount(){
    this.root=document.createElement('section');this.root.id='reader';this.root.setAttribute('aria-label',`阅读《${this.book.title}》`);
    this.root.innerHTML=`<header class="reader-header"><button class="quiet" data-reader="close" aria-label="返回书库">← 书库</button><span>${escapeHTML(this.book.title)}</span><button class="quiet" data-reader="settings" aria-label="阅读设置">Aa 设置</button></header><div class="reading-stage"></div><footer class="reader-footer"><button class="quiet" data-reader="prev" aria-label="上一页">←</button><button class="quiet" data-reader="toc">目录</button><span id="reader-position"></span><button class="quiet" data-reader="next" aria-label="下一页">→</button></footer><div class="reader-scrim" hidden></div><aside class="reader-panel" id="reader-settings" aria-label="阅读设置" hidden><div class="panel-title"><div><span class="panel-kicker">READING PREFERENCES</span><h2>阅读设置</h2></div><button class="quiet" data-reader="dismiss">完成</button></div><div class="setting-label">翻页方式</div><div class="reading-modes" role="group" aria-label="翻页方式">${MODES.map(([id,name,note])=>`<button data-mode="${id}" aria-pressed="${this.settings.mode===id}"><span class="mode-symbol mode-${id}" aria-hidden="true"></span><strong>${name}</strong><small>${note}</small></button>`).join('')}</div><label class="setting-line">字号 <input id="font-size" type="range" min="14" max="34" step="1" value="${this.settings.fontSize}"><output id="font-value">${this.settings.fontSize}</output></label><label class="setting-line">行距 <input id="line-height" type="range" min="1.3" max="2.5" step="0.1" value="${this.settings.lineHeight}"><output id="line-value">${this.settings.lineHeight}</output></label><div class="setting-label">阅读背景</div><div class="theme-options">${THEMES.map(t=>`<button data-theme="${t.id}" style="--swatch:${t.background};color:${t.ink}" aria-label="${t.name}背景">${t.name}</button>`).join('')}</div><label class="setting-line">字体 <select id="reader-font"><option value="serif">宋体</option><option value="sans">黑体</option></select></label><p class="panel-note">翻页方式、背景、字号与阅读位置自动保存在本机。</p></aside><aside class="reader-panel toc-panel" id="reader-toc" aria-label="章节目录" hidden><div class="panel-title"><h2>目录 <small>${this.chapters.length} 章</small></h2><button class="quiet" data-reader="dismiss">完成</button></div><div class="toc-list">${this.chapters.map((ch,i)=>`<button data-chapter="${i}">${escapeHTML(ch.title)}</button>`).join('')}</div></aside>`;
    document.body.append(this.root);document.body.classList.add('reading');
    this.root.addEventListener('click',e=>{
      const action=e.target.closest('[data-reader]')?.dataset.reader;
      if(action==='close')this.close();if(action==='next')this.next();if(action==='prev')this.prev();
      if(action==='settings'||action==='toc')this.panel(action);if(action==='dismiss'||e.target.classList.contains('reader-scrim'))this.panel();
      const theme=e.target.closest('[data-theme]')?.dataset.theme;if(theme){this.settings.theme=theme;this.applySettings();this.saveSettings();}
      const mode=e.target.closest('[data-mode]')?.dataset.mode;if(mode&&mode!==this.settings.mode){this.capturePosition();this.settings.mode=mode;this.saveSettings();this.layout().catch(this.onError);}
      const chapter=e.target.closest('[data-chapter]')?.dataset.chapter;if(chapter!==undefined){this.offset=this.chapters[Number(chapter)].start;this.panel();this.layout().catch(this.onError);}
    });
    this.root.querySelector('#reader-font').value=this.settings.font;
    for(const [id,key] of [['font-size','fontSize'],['line-height','lineHeight'],['reader-font','font']])this.root.querySelector('#'+id).addEventListener('change',async e=>{
      this.capturePosition();this.settings[key]=e.target.type==='range'?Number(e.target.value):e.target.value;
      this.root.querySelector('#font-value').textContent=this.settings.fontSize;this.root.querySelector('#line-value').textContent=this.settings.lineHeight;
      await this.saveSettings();await this.layout().catch(this.onError);
    });
    this.applySettings();
  }
  applySettings(){
    const theme=THEMES.find(t=>t.id===this.settings.theme)||THEMES[0];
    this.root.style.setProperty('--paper',theme.background);this.root.style.setProperty('--ink',theme.ink);
    this.root.style.setProperty('--reader-size',this.settings.fontSize+'px');this.root.style.setProperty('--reader-line',this.settings.lineHeight);
    this.root.style.setProperty('--reader-font',this.settings.font==='sans'?'"PingFang SC","Microsoft YaHei",system-ui,sans-serif':'"Noto Serif CJK SC","Songti SC",SimSun,serif');
    this.root.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme.id)));
    this.root.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===this.settings.mode)));
  }
  saveSettings(){return setSetting('reader',this.settings).catch(this.onError);}
  panel(which){for(const name of ['settings','toc'])this.root.querySelector('#reader-'+name).hidden=which!==name;this.root.querySelector('.reader-scrim').hidden=!which;}
  destroyView(){this.effectCleanup?.();this.effectCleanup=null;this.flip?.destroy();this.flip=null;this.viewport=null;cancelAnimationFrame(this.scrollFrame);clearTimeout(this.scrollTimer);}
  async layout(){
    const generation=++this.generation;this.destroyView();this.applySettings();this.chapterIndex=chapterAt(this.chapters,this.offset);
    const stage=this.root.querySelector('.reading-stage');stage.innerHTML='';stage.dataset.mode=this.settings.mode;
    if(this.settings.mode==='scroll'){await this.renderScroll(stage,generation);if(generation!==this.generation)return;this.updatePosition();return;}
    const chapter=this.chapters[this.chapterIndex],body=this.text.slice(chapter.start,chapter.end);
    const width=Math.max(200,Math.floor(stage.clientWidth)),height=Math.max(180,Math.floor(stage.clientHeight));
    const host=document.createElement('div');host.id='flip-host';host.style.width=width+'px';host.style.height=height+'px';stage.append(host);
    const measure=document.createElement('article');measure.className='reader-page measuring';measure.style.width=width+'px';measure.style.height=height+'px';measure.innerHTML='<small class="paper-heading"></small><div class="paper-body"></div><small class="paper-number"></small>';this.root.append(measure);
    const box=measure.querySelector('.paper-body');this.pages=[];let start=0;
    while(start<body.length){
      let low=1,high=Math.min(body.length-start,10000);
      while(low<high){const mid=Math.ceil((low+high)/2);box.textContent=body.slice(start,start+mid);if(box.scrollHeight<=box.clientHeight+.5)low=mid;else high=mid-1;}
      if(low>1&&/[\uD800-\uDBFF]/.test(body[start+low-1]))low--;
      this.pages.push({start:chapter.start+start,text:body.slice(start,start+low)});start+=low;
      if(this.pages.length%25===0){await new Promise(requestAnimationFrame);if(generation!==this.generation){measure.remove();return;}}
    }
    measure.remove();if(generation!==this.generation)return;if(!this.pages.length)this.pages.push({start:chapter.start,text:''});
    const elements=this.pages.map((p,i)=>{const el=document.createElement('article');el.className='reader-page';el.dataset.density='soft';el.innerHTML=`<small class="paper-heading">${escapeHTML(chapter.title)}</small><div class="paper-body"></div><small class="paper-number">${i+1} / ${this.pages.length}</small>`;el.querySelector('.paper-body').textContent=p.text;host.append(el);return el;});
    this.page=pageAtOffset(this.pages,this.offset);
    if(this.settings.mode==='slide'){
      host.className='slide-viewport';this.viewport=host;host.scrollLeft=this.page*width;
      const track=()=>{clearTimeout(this.scrollTimer);this.scrollTimer=setTimeout(()=>{if(this.viewport!==host)return;const page=Math.max(0,Math.min(this.pages.length-1,Math.round(host.scrollLeft/width)));if(page!==this.page){this.page=page;this.offset=this.pages[page].start;}this.updatePosition();this.persist();},100);};
      host.addEventListener('scroll',track,{passive:true});this.bindSlideDrag(host,width);this.bindBoundaryGesture(host,width);
    }else{
      this.flip=new PageFlip(host,{width,height,size:'fixed',usePortrait:true,autoSize:false,drawShadow:true,maxShadowOpacity:.46,flippingTime:matchMedia('(prefers-reduced-motion: reduce)').matches?1:620,startPage:this.page,showCover:false,showPageCorners:false,mobileScrollSupport:false,swipeDistance:28,disableFlipByClick:true});
      this.effectCleanup=paperBackEffect(this.flip,host);
      let restoring=true;
      this.flip.on('flip',e=>{this.page=e.data;if(!restoring){this.offset=this.pages[e.data]?.start??this.offset;this.persist();}this.updatePosition();});this.flip.loadFromHTML(elements);restoring=false;this.bindBoundaryGesture(host,width);
    }
    this.updatePosition();await this.persist();this.markChapter();
  }
  bindBoundaryGesture(host,width){
    let pointer;host.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,index:this.currentPage()};});
    host.addEventListener('pointerup',e=>{if(!pointer)return;const p=pointer,dx=e.clientX-p.x,dy=Math.abs(e.clientY-p.y);pointer=null;
      if(Math.abs(dx)<18&&dy<18){const x=e.clientX-host.getBoundingClientRect().left;if(x>width*.35&&x<width*.65)this.panel('settings');}
      if(dx < -55&&dy<90&&p.index===this.pages.length-1&&this.chapterIndex<this.chapters.length-1)this.jumpChapter(1);
      else if(dx>55&&dy<90&&p.index===0&&this.chapterIndex>0)this.jumpChapter(-1,true);
    });
  }
  bindSlideDrag(host,width){
    let drag;
    host.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0)return;drag={x:e.clientX,left:host.scrollLeft,page:this.currentPage()};host.setPointerCapture(e.pointerId);host.style.scrollSnapType='none';host.classList.add('dragging');e.preventDefault();});
    host.addEventListener('pointermove',e=>{if(drag)host.scrollLeft=drag.left-(e.clientX-drag.x);});
    const end=e=>{if(!drag)return;const moved=e.clientX-drag.x;let target=drag.page;if(e.type!=='pointercancel'&&Math.abs(moved)>width*.16)target+=moved<0?1:-1;target=Math.max(0,Math.min(this.pages.length-1,target));drag=null;host.style.scrollSnapType='';host.classList.remove('dragging');host.scrollTo({left:target*width,behavior:this.motion()});};
    host.addEventListener('pointerup',end);host.addEventListener('pointercancel',end);
  }
  scrollChapter(index){
    const chapter=this.chapters[index],el=document.createElement('article');el.className='reader-page scroll-chapter';el.dataset.scrollChapter=index;
    el.innerHTML=`<h2 class="scroll-heading">${escapeHTML(chapter.title)}</h2><div class="paper-body"></div>`;el.querySelector('.paper-body').textContent=this.text.slice(chapter.start,chapter.end);return el;
  }
  async renderScroll(stage,generation){
    const viewport=document.createElement('div');viewport.className='scroll-viewport';viewport.tabIndex=0;viewport.setAttribute('aria-label','上下滑动阅读正文');stage.append(viewport);this.viewport=viewport;
    for(let i=Math.max(0,this.chapterIndex-1);i<=Math.min(this.chapters.length-1,this.chapterIndex+1);i++)viewport.append(this.scrollChapter(i));
    await new Promise(requestAnimationFrame);if(generation!==this.generation)return;
    const current=viewport.querySelector(`[data-scroll-chapter="${this.chapterIndex}"]`),node=current.querySelector('.paper-body').firstChild;
    const at=Math.min(Math.max(0,this.offset-this.chapters[this.chapterIndex].start),node.length-1),range=document.createRange();range.setStart(node,at);range.setEnd(node,Math.min(node.length,at+1));
    const top=at?range.getBoundingClientRect().top:current.getBoundingClientRect().top;
    viewport.scrollTop+=top-viewport.getBoundingClientRect().top-(at?22:0);
    viewport.addEventListener('scroll',()=>{cancelAnimationFrame(this.scrollFrame);this.scrollFrame=requestAnimationFrame(()=>{if(this.viewport!==viewport)return;this.capturePosition();this.maintainScroll();this.updatePosition();clearTimeout(this.scrollTimer);this.scrollTimer=setTimeout(()=>this.persist(),140);});},{passive:true});
    this.maintainScroll();this.scrollAnchorTop=viewport.scrollTop;this.markChapter();
  }
  capturePosition(){
    if(this.settings.mode==='slide'&&this.viewport&&this.pages?.length){const page=Math.max(0,Math.min(this.pages.length-1,Math.round(this.viewport.scrollLeft/this.viewport.clientWidth)));if(page!==this.page){this.page=page;this.offset=this.pages[page].start;}}
    if(this.settings.mode!=='scroll'||!this.viewport)return;
    const v=this.viewport;if(Math.abs(v.scrollTop-this.scrollAnchorTop)<.5)return;this.scrollAnchorTop=v.scrollTop;const top=v.getBoundingClientRect().top+24;
    const article=[...v.children].find(el=>el.getBoundingClientRect().bottom>top);if(!article)return;
    this.chapterIndex=Number(article.dataset.scrollChapter);const node=article.querySelector('.paper-body').firstChild;
    if(!node)return;let low=0,high=node.length;const range=document.createRange();
    if(article.getBoundingClientRect().top>=top){this.offset=this.chapters[this.chapterIndex].start;return;}
    while(low<high){const mid=Math.floor((low+high)/2);range.setStart(node,mid);range.setEnd(node,Math.min(node.length,mid+1));if(range.getBoundingClientRect().bottom<top)low=mid+1;else high=mid;}
    this.offset=this.chapters[this.chapterIndex].start+low;this.markChapter();
  }
  maintainScroll(){
    const v=this.viewport;if(!v)return;
    let first=Number(v.firstElementChild.dataset.scrollChapter),last=Number(v.lastElementChild.dataset.scrollChapter);
    if(v.scrollTop<v.clientHeight&&first>0){const previous=this.scrollChapter(first-1),before=v.scrollHeight;v.prepend(previous);v.scrollTop+=v.scrollHeight-before;first--;}
    while(v.scrollHeight-v.scrollTop-v.clientHeight<v.clientHeight*1.5&&last<this.chapters.length-1&&v.children.length<12)v.append(this.scrollChapter(++last));
    while(v.children.length>5&&Number(v.firstElementChild.dataset.scrollChapter)<this.chapterIndex-1){const before=v.scrollHeight;v.firstElementChild.remove();v.scrollTop-=before-v.scrollHeight;}
    while(v.children.length>5&&Number(v.lastElementChild.dataset.scrollChapter)>this.chapterIndex+2&&v.lastElementChild.getBoundingClientRect().top>v.getBoundingClientRect().bottom+v.clientHeight*2)v.lastElementChild.remove();
    this.scrollAnchorTop=v.scrollTop;
  }
  currentPage(){return this.flip?.getCurrentPageIndex()??this.page??0;}
  markChapter(){this.root.querySelectorAll('[data-chapter]').forEach(b=>b.classList.toggle('current',Number(b.dataset.chapter)===this.chapterIndex));}
  updatePosition(){
    this.root.querySelector('#reader-position').textContent=`${Math.round(this.offset/this.text.length*100)}% · ${this.chapterIndex+1}/${this.chapters.length}章`;
    const scrolling=this.settings.mode==='scroll';
    this.root.querySelector('[data-reader="prev"]').disabled=this.chapterIndex===0&&(scrolling?this.viewport.scrollTop<2:this.currentPage()===0);
    this.root.querySelector('[data-reader="next"]').disabled=this.chapterIndex===this.chapters.length-1&&(scrolling?this.viewport.scrollTop+this.viewport.clientHeight>=this.viewport.scrollHeight-2:this.currentPage()===this.pages.length-1);
  }
  async jumpChapter(direction,last=false){const index=this.chapterIndex+direction;if(index<0||index>=this.chapters.length)return;this.offset=last?this.chapters[index].end-1:this.chapters[index].start;await this.layout().catch(this.onError);}
  next(){
    if(this.settings.mode==='scroll'){this.viewport?.scrollBy({top:this.viewport.clientHeight*.85,behavior:this.motion()});return;}
    if(this.flip&&this.flip.getState()!=='read')return;
    if(this.currentPage()===this.pages.length-1){this.jumpChapter(1);return;}
    if(this.flip)this.flip.flipNext('bottom');else this.viewport.scrollTo({left:(this.currentPage()+1)*this.viewport.clientWidth,behavior:this.motion()});
  }
  prev(){
    if(this.settings.mode==='scroll'){this.viewport?.scrollBy({top:-this.viewport.clientHeight*.85,behavior:this.motion()});return;}
    if(this.flip&&this.flip.getState()!=='read')return;
    if(this.currentPage()===0){this.jumpChapter(-1,true);return;}
    if(this.flip)this.flip.flipPrev('bottom');else this.viewport.scrollTo({left:(this.currentPage()-1)*this.viewport.clientWidth,behavior:this.motion()});
  }
  motion(){return matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';}
  persist(){return saveProgress(this.book.id,this.offset).catch(this.onError);}
  async close(){++this.generation;clearTimeout(this.resizeTimer);this.capturePosition();await this.persist();this.destroyView();this.root?.remove();document.body.classList.remove('reading');document.removeEventListener('keydown',this.keyHandler);window.removeEventListener('resize',this.resizeHandler);document.removeEventListener('visibilitychange',this.hideHandler);this.onClose();}
}
