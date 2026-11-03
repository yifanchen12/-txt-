import {PageFlip} from 'page-flip';
import {getText,saveProgress,getSetting,setSetting} from './storage.js';
import {splitChapters,chapterAt,escapeHTML} from './core.js';

export const THEMES=[
  {id:'paper',name:'米色',background:'#f5f1e8',ink:'#191919'},
  {id:'white',name:'默认',background:'#ffffff',ink:'#191919'},
  {id:'green',name:'浅绿',background:'#e0eee1',ink:'#191919'},
  {id:'blue',name:'浅蓝',background:'#dcebef',ink:'#191919'},
  {id:'yellow',name:'浅黄',background:'#efe2c0',ink:'#191919'},
  {id:'night',name:'深夜',background:'#191919',ink:'#a3a3a3'}
];
export class Reader {
  constructor({onClose,onError}) {this.onClose=onClose;this.onError=onError;this.offset=0;this.generation=0;}
  async open(book) {
    this.book=book;this.text=await getText(book.id);
    if(!this.text)throw new Error('这本书的正文未保存在本机，请重新下载或导入');
    this.chapters=splitChapters(this.text);this.offset=Math.min(book.offset||0,this.text.length-1);
    this.settings={fontSize:20,lineHeight:1.9,theme:'paper',font:'serif',mode:'curl',...(await getSetting('reader'))};
    this.mount();await document.fonts.ready;await this.layout();
    this.keyHandler=e=>{if(e.target.closest('input,select,textarea'))return;if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();this.next();}if(e.key==='ArrowLeft')this.prev();if(e.key==='Escape')this.close();};
    this.resizeHandler=()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.layout().catch(this.onError),180);};
    this.hideHandler=()=>this.persist();document.addEventListener('keydown',this.keyHandler);window.addEventListener('resize',this.resizeHandler);document.addEventListener('visibilitychange',this.hideHandler);
  }
  mount() {
    this.root=document.createElement('section');this.root.id='reader';this.root.setAttribute('aria-label',`阅读《${this.book.title}》`);
    this.root.innerHTML=`<header class="reader-header"><button class="quiet" data-reader="close" aria-label="返回书库">← 书库</button><span>${escapeHTML(this.book.title)}</span><button class="quiet" data-reader="settings" aria-label="阅读设置">Aa 设置</button></header><div class="reading-stage"><div id="flip-host"></div></div><footer class="reader-footer"><button class="quiet" data-reader="prev" aria-label="上一页">←</button><button class="quiet" data-reader="toc">目录</button><span id="reader-position"></span><button class="quiet" data-reader="next" aria-label="下一页">→</button></footer><div class="reader-scrim" hidden></div><aside class="reader-panel" id="reader-settings" aria-label="阅读设置" hidden><div class="panel-title"><h2>让阅读更舒服</h2><button class="quiet" data-reader="dismiss">完成</button></div><label class="setting-line">字号 <input id="font-size" type="range" min="14" max="34" step="1" value="${this.settings.fontSize}"><output id="font-value">${this.settings.fontSize}</output></label><label class="setting-line">行距 <input id="line-height" type="range" min="1.3" max="2.5" step="0.1" value="${this.settings.lineHeight}"><output id="line-value">${this.settings.lineHeight}</output></label><div class="setting-label">阅读背景</div><div class="theme-options">${THEMES.map(t=>`<button data-theme="${t.id}" style="--swatch:${t.background};color:${t.ink}" aria-label="${t.name}背景">${t.name}</button>`).join('')}</div><label class="setting-line">字体 <select id="reader-font"><option value="serif">宋体</option><option value="sans">黑体</option></select></label><label class="setting-line">翻页 <select id="reader-mode"><option value="curl">仿真翻页</option><option value="instant">直接翻页</option></select></label><p class="panel-note">拖动纸张边角翻页，点左右箭头也可以。设置与进度保存在本机。</p></aside><aside class="reader-panel toc-panel" id="reader-toc" aria-label="章节目录" hidden><div class="panel-title"><h2>目录 <small>${this.chapters.length} 章</small></h2><button class="quiet" data-reader="dismiss">完成</button></div><div class="toc-list">${this.chapters.map((ch,i)=>`<button data-chapter="${i}">${escapeHTML(ch.title)}</button>`).join('')}</div></aside>`;
    document.body.append(this.root);document.body.classList.add('reading');
    this.root.addEventListener('click',e=>{
      const action=e.target.closest('[data-reader]')?.dataset.reader;
      if(action==='close')this.close();if(action==='next')this.next();if(action==='prev')this.prev();
      if(action==='settings'||action==='toc')this.panel(action);
      if(action==='dismiss'||e.target.classList.contains('reader-scrim'))this.panel();
      const theme=e.target.closest('[data-theme]')?.dataset.theme;if(theme){this.settings.theme=theme;this.applySettings();this.saveSettings();}
      const chapter=e.target.closest('[data-chapter]')?.dataset.chapter;
      if(chapter!==undefined){this.offset=this.chapters[Number(chapter)].start;this.panel();this.layout().catch(this.onError);}
    });
    this.root.querySelector('#reader-font').value=this.settings.font;this.root.querySelector('#reader-mode').value=this.settings.mode;
    for(const [id,key] of [['font-size','fontSize'],['line-height','lineHeight'],['reader-font','font'],['reader-mode','mode']]){
      this.root.querySelector('#'+id).addEventListener('change',async e=>{
        this.settings[key]=e.target.type==='range'?Number(e.target.value):e.target.value;
        this.root.querySelector('#font-value').textContent=this.settings.fontSize;this.root.querySelector('#line-value').textContent=this.settings.lineHeight;
        await this.saveSettings();await this.layout().catch(this.onError);
      });
    }
    this.applySettings();
  }
  applySettings() {
    const theme=THEMES.find(t=>t.id===this.settings.theme)||THEMES[0];
    this.root.style.setProperty('--paper',theme.background);this.root.style.setProperty('--ink',theme.ink);
    this.root.style.setProperty('--reader-size',this.settings.fontSize+'px');this.root.style.setProperty('--reader-line',this.settings.lineHeight);
    this.root.style.setProperty('--reader-font',this.settings.font==='sans'?'system-ui, sans-serif':'"Noto Serif CJK SC", "Songti SC", SimSun, serif');
    this.root.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme.id)));
  }
  saveSettings() {return setSetting('reader',this.settings).catch(this.onError);}
  panel(which) {for(const name of ['settings','toc'])this.root.querySelector('#reader-'+name).hidden=which!==name;this.root.querySelector('.reader-scrim').hidden=!which;}
  async layout() {
    const generation=++this.generation;
    this.applySettings();this.chapterIndex=chapterAt(this.chapters,this.offset);
    const chapter=this.chapters[this.chapterIndex],body=this.text.slice(chapter.start,chapter.end);
    const stage=this.root.querySelector('.reading-stage');
    const width=Math.max(200,Math.floor(stage.clientWidth)),height=Math.max(180,Math.floor(stage.clientHeight));
    if(this.flip){this.flip.destroy();this.flip=null;}
    stage.innerHTML='<div id="flip-host"></div>';
    const host=stage.firstElementChild;host.style.width=width+'px';host.style.height=height+'px';
    const measure=document.createElement('article');measure.className='reader-page measuring';measure.style.width=width+'px';measure.style.height=height+'px';
    measure.innerHTML='<small class="paper-heading"></small><div class="paper-body"></div><small class="paper-number"></small>';
    this.root.append(measure);
    const box=measure.querySelector('.paper-body');
    this.pages=[];let start=0;
    while(start<body.length){
      let low=1,high=Math.min(body.length-start,10000);
      while(low<high){const mid=Math.ceil((low+high)/2);box.textContent=body.slice(start,start+mid);if(box.scrollHeight<=box.clientHeight+0.5)low=mid;else high=mid-1;}
      // Avoid cutting a UTF-16 surrogate pair in half.
      if(low>1&&/[\uD800-\uDBFF]/.test(body[start+low-1]))low--;
      this.pages.push({start:chapter.start+start,text:body.slice(start,start+low)});start+=low;
      if(this.pages.length%25===0){await new Promise(requestAnimationFrame);if(generation!==this.generation){measure.remove();return;}}
    }
    measure.remove();if(generation!==this.generation)return;
    if(!this.pages.length)this.pages.push({start:chapter.start,text:''});
    const elements=this.pages.map((p,i)=>{const el=document.createElement('article');el.className='reader-page';el.dataset.density='soft';el.innerHTML=`<small class="paper-heading">${escapeHTML(chapter.title)}</small><div class="paper-body"></div><small class="paper-number">${i+1} / ${this.pages.length}</small>`;el.querySelector('.paper-body').textContent=p.text;host.append(el);return el;});
    let page=0;for(let i=0;i<this.pages.length;i++){if(this.pages[i].start<=this.offset)page=i;else break;}
    this.flip=new PageFlip(host,{width,height,size:'fixed',usePortrait:true,autoSize:false,drawShadow:true,maxShadowOpacity:0.32,flippingTime:matchMedia('(prefers-reduced-motion: reduce)').matches?1:480,startPage:page,showCover:false,mobileScrollSupport:false,swipeDistance:28,disableFlipByClick:true});
    this.flip.on('flip',e=>{this.offset=this.pages[e.data]?.start??this.offset;this.updatePosition();this.persist();});
    this.flip.loadFromHTML(elements);this.updatePosition();await this.persist();
    let pointer;
    host.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,index:this.flip?.getCurrentPageIndex()};});
    host.addEventListener('pointerup',e=>{
      if(!pointer)return;const dx=e.clientX-pointer.x,dy=Math.abs(e.clientY-pointer.y),p=pointer;pointer=null;
      if(Math.abs(dx)<18&&dy<18){const x=e.clientX-host.getBoundingClientRect().left;if(x>width*.35&&x<width*.65)this.panel('settings');}
      if(dx < -45&&dy<90&&p.index===this.pages.length-1&&this.chapterIndex<this.chapters.length-1)this.jumpChapter(1);
      else if(dx>45&&dy<90&&p.index===0&&this.chapterIndex>0)this.jumpChapter(-1,true);
    });
    this.root.querySelectorAll('[data-chapter]').forEach(b=>b.classList.toggle('current',Number(b.dataset.chapter)===this.chapterIndex));
  }
  updatePosition() {
    this.root.querySelector('#reader-position').textContent=`${Math.round(this.offset/this.text.length*100)}% · ${this.chapterIndex+1}/${this.chapters.length}章`;
    this.root.querySelector('[data-reader="prev"]').disabled=this.chapterIndex===0&&this.flip.getCurrentPageIndex()===0;
    this.root.querySelector('[data-reader="next"]').disabled=this.chapterIndex===this.chapters.length-1&&this.flip.getCurrentPageIndex()===this.pages.length-1;
  }
  async jumpChapter(direction,last=false) {
    const index=this.chapterIndex+direction;if(index<0||index>=this.chapters.length)return;
    this.offset=last?this.chapters[index].end-1:this.chapters[index].start;
    await this.layout().catch(this.onError);
  }
  next() {
    if(!this.flip||this.flip.getState()!=='read')return;
    if(this.flip.getCurrentPageIndex()===this.pages.length-1){this.jumpChapter(1);return;}
    if(this.settings.mode==='instant')this.flip.turnToNextPage();else this.flip.flipNext('bottom');
  }
  prev() {
    if(!this.flip||this.flip.getState()!=='read')return;
    if(this.flip.getCurrentPageIndex()===0){this.jumpChapter(-1,true);return;}
    if(this.settings.mode==='instant')this.flip.turnToPrevPage();else this.flip.flipPrev('bottom');
  }
  persist() {return saveProgress(this.book.id,this.offset).catch(this.onError);}
  async close() {
    ++this.generation;clearTimeout(this.resizeTimer);await this.persist();this.flip?.destroy();this.root?.remove();document.body.classList.remove('reading');
    document.removeEventListener('keydown',this.keyHandler);window.removeEventListener('resize',this.resizeHandler);document.removeEventListener('visibilitychange',this.hideHandler);this.onClose();
  }
}
