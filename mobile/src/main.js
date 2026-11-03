import './style.css';
import {PLATFORMS,loadRanking,searchBooks,resolveBook,downloadBook,defaultSources,sources} from './catalog.js';
import {native} from './network.js';
import {bookId,escapeHTML as h,coverPlaceholder,decodeText} from './core.js';
import {listBooks,saveBook,getText,deleteBook,getSetting,setSetting,getCache} from './storage.js';
import {Reader} from './reader.js';

const icons={book:'<path d="M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/><path d="M12 6v15"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',shelf:'<path d="M3 21h18M5 4h4v14H5Zm8 0h4v14h-4Zm5 1 3-1 3 14-3 1Z"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',settings:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>'};
const icon=name=>`<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.book}</svg>`;
const app=document.querySelector('#app');
const state={route:'discover',platform:'all',ranks:{},library:[],recommendations:[],search:[],query:'',searching:false,searchStatus:'',jobs:new Map(),bookMap:new Map(),disabled:[],sort:'recent'};
let searchController,rankController,rankLoading=false,toastTimer;
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5000);}
const report=e=>toast(e?.name==='QuotaExceededError'?'本机存储空间不足，请导出备份后清理书库。':e.message||String(e));
function remember(b){state.bookMap.set(b.id||bookId(b),b);return b.id||bookId(b);}
function cover(b,cls=''){const id=remember(b);return `<img class="cover ${cls}" data-cover="${h(id)}" src="${h(b.cover||coverPlaceholder(b))}" alt="《${h(b.title)}》封面" width="120" height="170" loading="lazy" referrerpolicy="no-referrer">`;}
function empty(title,body,action=''){return `<div class="empty"><div class="empty-icon">${icon('book')}</div><h3>${h(title)}</h3><p>${h(body)}</p>${action}</div>`;}
function navigation(){return [['discover','grid','发现'],['rankings','book','排行榜'],['library','shelf','本地书架'],['downloads','download','下载']].map(([route,i,label])=>`<button data-route="${route}" class="nav-item ${state.route===route?'active':''}" ${state.route===route?'aria-current="page"':''}>${icon(i)}<span>${label}</span>${route==='downloads'&&[...state.jobs.values()].some(j=>j.status==='running')?'<i class="notification-dot"></i>':''}</button>`).join('');}
function render(){
  const focused=document.activeElement?.id,selection=focused==='search-input'?document.activeElement.selectionStart:null;
  app.innerHTML=`<header class="site-header"><div class="header-inner"><button class="brand" data-route="discover" aria-label="拾页首页"><span class="brand-mark">${icon('book')}</span><strong>拾页</strong><span class="brand-en">SHIYE</span></button><nav class="desktop-nav" aria-label="主导航">${navigation()}</nav><button class="header-settings" data-action="settings" aria-label="书源设置">${icon('settings')}</button></div></header><main id="main">${state.route==='discover'?discover():state.route==='rankings'?rankings():state.route==='library'?library():state.route==='downloads'?downloads():settings()}</main><footer class="site-footer"><span>拾页 · 故事随身，好书随行</span><a href="https://github.com/yifanchen12/-txt-/releases/latest" target="_blank" rel="noreferrer">下载手机应用 ↗</a></footer><nav class="mobile-nav" aria-label="手机导航">${navigation()}</nav><input id="import-txt" type="file" accept=".txt,text/plain" multiple hidden>`;
  app.querySelectorAll('[data-cover]').forEach(img=>{img.addEventListener('error',()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src=coverPlaceholder(state.bookMap.get(img.dataset.cover)||{});});});
  app.querySelector('#search-input')?.addEventListener('input',e=>state.query=e.target.value);
  app.querySelector('#search-form')?.addEventListener('submit',e=>{e.preventDefault();runSearch();});
  app.querySelector('#import-txt')?.addEventListener('change',async e=>{for(const f of e.target.files)await importText(f);});
  if(focused==='search-input'){const input=app.querySelector('#search-input');input?.focus({preventScroll:true});if(selection!==null)input?.setSelectionRange(selection,selection);}
}
function searchBar(){return `<form id="search-form" class="search-box" role="search"><label class="sr-only" for="search-input">搜索小说书名</label>${icon('search')}<input id="search-input" name="q" type="search" autocomplete="off" placeholder="输入想读的小说名，发现你的下一本好书" value="${h(state.query)}" required maxlength="100"><button type="submit" class="primary">${state.searching?'重新搜索':'搜索好书'}</button></form>`;}
function discover(){
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow"><span></span> 把喜欢的故事，留在身边</div><h1>翻开一页，<br>遇见另一个世界<span>。</span></h1><p>从热榜发现好书，下载到本机。<br class="mobile-only">从此，阅读不必等待网络。</p></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><span class="art-star star-one">✧</span><span class="art-star star-two">✦</span><div class="drawn-book book-back"><span>山海之间</span></div><div class="drawn-book book-front"><i></i><span>故事<br>未完</span><small>ONE MORE PAGE</small></div><div class="art-caption">给自己，一段阅读的时间。</div></div></section><section class="search-section">${searchBar()}<div class="search-hint"><span>起点</span><i></i><span>番茄</span><i></i><span>晋江</span><em>本机保存 · 离线可读</em></div></section>${state.query&&state.searching||state.hasSearch?searchResults():''}<section class="section ranking-section"><div class="section-heading"><div><div class="eyebrow">THE READING LIST</div><h2>榜上好故事<span class="heading-dot">.</span></h2></div><button class="text-button" data-action="refresh">${rankLoading?'停止刷新':'刷新榜单'} ↻</button></div><p class="section-intro">按官方榜单顺序，筛选已在书源匹配到正文的完本作品。排名保留官方名次。</p><div class="ranking-grid">${Object.keys(PLATFORMS).map(p=>rankingBoard(p)).join('')}</div></section>${continueReading()}<section class="section recommendations"><div class="section-heading"><div><div class="eyebrow">KEEP EXPLORING</div><h2>往下翻，还有好故事<span class="heading-dot">.</span></h2></div><span class="muted">来自官方榜单与本次搜索</span></div><div class="book-grid">${recommendationBooks().slice(0,24).map(b=>bookCard(b)).join('')}</div>${!recommendationBooks().length?empty('故事正在来的路上','刷新榜单，或搜索想读的小说。也可以导入自己的 TXT，立即开始阅读。','<button class="outline" data-action="import">导入本地小说</button>'):''}</section>`;
}
function rankingBoard(platform,full=false){
  const p=PLATFORMS[platform],r=state.ranks[platform]||{},items=r.books||[];
  return `<article class="ranking-board ${full?'expanded':''}" style="--platform-color:${p.color}"><div class="board-heading"><div><span class="platform-symbol">${p.name[0]}</span><h3>${p.name}<small>${p.label} · 可下载完本</small></h3></div><a href="${p.url}" target="_blank" rel="noreferrer" aria-label="查看${p.name}官方榜单">↗</a></div><ol class="ranking-list">${items.slice(0,full?20:5).map(b=>`<li><span class="rank-number ${b.rank<=3?'top':''}">${String(b.rank).padStart(2,'0')}</span><button class="rank-book" data-book="${h(remember(b))}">${cover(b)}<span class="rank-book-copy"><strong>${h(b.title)}</strong><small>${h(b.author||'作者未知')}</small><em>${h(b.genre||'小说')} · 已匹配正文</em></span></button></li>`).join('')}</ol>${!items.length?`<div class="rank-empty">${r.loading?'<div class="loading-line"></div><p>读取官方榜单并核对下载源…</p>':`<p>${h(r.error||'暂未匹配到可下载的完本作品')}</p>`}<small>${r.checked!==undefined?`已核对 ${r.checked}/${r.rawCount||'…'} 本`:r.error?'可以稍后重试，或先搜索书名':'尚未更新'}</small></div>`:''}<div class="board-footer"><span>${r.loading?`核对中 ${r.checked||0}/${r.rawCount||'…'}`:r.time?`${r.stale?'缓存 · ':''}${new Date(r.time).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 更新`:'等待更新'}</span><button data-platform="${platform}" class="text-button">查看完整榜单 →</button></div></article>`;
}
function rankings(){return `<section class="page-title"><div class="eyebrow">WHAT'S BEING READ</div><h1>排行榜<span>.</span></h1><p>官方热度，有据可循。只收录已匹配到正文的完本作品。</p></section><div class="tab-row">${[['all','全部榜单'],...Object.entries(PLATFORMS).map(([k,v])=>[k,v.name])].map(([k,v])=>`<button data-platform="${k}" class="tab ${state.platform===k?'selected':''}">${v}</button>`).join('')}<button class="text-button push-right" data-action="refresh">${rankLoading?'停止刷新':'刷新'} ↻</button></div><div class="ranking-grid ${state.platform!=='all'?'single-ranking':''}">${(state.platform==='all'?Object.keys(PLATFORMS):[state.platform]).map(p=>rankingBoard(p,true)).join('')}</div>`;}
function bookCard(b){const local=state.library.some(x=>x.id===b.id),platform=PLATFORMS[b.platform]?.name;return `<article class="book-card"><button class="cover-button" data-book="${h(remember(b))}">${cover(b)}<span class="cover-action">${local?'继续阅读':'查看这本书'} ${icon('arrow')}</span></button><button class="book-title" data-book="${h(b.id)}">${h(b.title)}</button><p class="book-author">${h(b.author||'作者未知')}</p><div class="book-tags">${platform?`<span>${platform}</span>`:''}<span>${h(b.genre||'小说')}</span>${local?'<span class="saved-tag">已保存</span>':''}</div></article>`;}
function recommendationBooks(){const map=new Map();for(const b of [...Object.values(state.ranks).flatMap(r=>r.books||[]),...state.search,...state.recommendations,...Object.values(state.ranks).flatMap(r=>r.raw||[])])if(!map.has(b.id))map.set(b.id,b);return [...map.values()];}
function continueReading(){const b=state.library.find(x=>x.offset>0);if(!b)return '';return `<section class="continue-card">${cover(b)}<div><div class="eyebrow">接着上次的故事</div><h3>${h(b.title)}</h3><p>${h(b.author)} · 阅读到 ${Math.round(b.offset/Math.max(b.characters||1,1)*100)}%</p></div><button class="primary" data-read="${h(remember(b))}">继续阅读 ${icon('arrow')}</button></section>`;}
function searchResults(){return `<section class="section search-results"><div class="section-heading"><h2>“${h(state.searchedQuery||state.query)}” 的搜索结果</h2><button class="text-button" data-action="${state.searching?'cancel-search':'clear-search'}">${state.searching?'停止搜索':'收起结果'}</button></div><p class="muted" role="status">${h(state.searchStatus)}</p><div class="book-grid">${state.search.map(b=>bookCard(b)).join('')}</div>${!state.search.length&&!state.searching?empty('暂时没有找到这本书','试试完整书名。部分书源当前可能无法连接，已保存的书仍可在本地阅读。'):''}</section>`;}
function library(){const books=[...state.library];if(state.sort==='title')books.sort((a,b)=>a.title.localeCompare(b.title,'zh'));return `<section class="page-title"><div class="eyebrow">YOUR LITTLE LIBRARY</div><h1>本地书架<span>.</span></h1><p>${books.length?`${books.length} 本书，已经在这台设备上。断网，也有故事陪你。`:'把喜欢的书存下来，慢慢读。'}</p></section><div class="library-toolbar"><button class="primary" data-action="import">＋ 导入 TXT</button><button class="outline" data-action="paste">粘贴正文</button><button class="outline" data-action="backup">备份书库</button><label class="sort-label">排序 <select id="library-sort"><option value="recent" ${state.sort==='recent'?'selected':''}>最近阅读</option><option value="title" ${state.sort==='title'?'selected':''}>按书名</option></select></label></div><div class="library-grid">${books.map(b=>`<article class="library-card">${cover(b)}<div><h3>${h(b.title)}</h3><p>${h(b.author||'本地导入')}</p><small>${(b.bytes/1024).toFixed(0)} KB · ${b.offset?`${Math.min(100,Math.round(b.offset/Math.max(1,b.characters)*100))}%`:'尚未开始'}</small><div class="library-actions"><button class="primary small" data-read="${h(remember(b))}">${b.offset?'继续阅读':'开始阅读'}</button><button class="quiet" data-export="${h(b.id)}" aria-label="导出${h(b.title)}">导出</button><button class="quiet danger" data-delete="${h(b.id)}" aria-label="移除${h(b.title)}">移除</button></div></div></article>`).join('')}</div>${!books.length?empty('你的第一本书，从这里开始','下载小说，或导入本机 TXT 文件。书籍正文、封面和阅读进度都会保存在当前设备。'):''}<p class="storage-note">书库保存在当前应用或浏览器内。卸载应用、清理网站数据前，请先导出或备份。</p>`;}
function downloads(){const jobs=[...state.jobs.values()].reverse();return `<section class="page-title"><div class="eyebrow">STORIES TO GO</div><h1>下载<span>.</span></h1><p>小说直接从书源保存到这台设备，无需电脑中转。</p></section><div class="download-list">${jobs.map(j=>`<article class="download-item">${cover(j.book)}<div class="download-copy"><h3>${h(j.book.title)}</h3><p>${h(j.status==='done'?'已完整保存到本机':j.status==='failed'?j.error:j.status==='cancelled'?'已取消，未加入书库':j.label||'正在连接书源')}</p>${j.status==='running'?`<progress max="${j.total||1}" value="${j.done||0}"></progress><small>${j.total?`${j.done||0}/${j.total} 章`:'核对正文中…'}</small>`:''}</div>${j.status==='running'?`<button class="outline" data-cancel="${h(j.book.id)}">取消</button>`:j.status==='done'?`<button class="primary" data-read="${h(j.book.id)}">阅读</button>`:`<button class="outline" data-book="${h(j.book.id)}">重试</button>`}</article>`).join('')}</div>${!jobs.length?empty('这里等着下一本好书','在排行榜或搜索结果中打开小说，选择“下载并保存”。','<button class="outline" data-route="discover">去找好书</button>'):''}`;}
function settings(){return `<section class="page-title"><div class="eyebrow">MAKE IT YOURS</div><h1>书源与应用<span>.</span></h1><p>手机直接连接已启用的公开书源。来源是否可用取决于当前网络和站点状态。</p></section><section class="settings-card"><h2>下载源</h2>${defaultSources.download_sources.filter(s=>s.type!=='direct_from_candidate').map(s=>`<label class="source-toggle"><span><strong>${h(s.name)}</strong><small>${h(new URL(s.base_url).hostname)}</small></span><input type="checkbox" data-source="${h(s.name)}" ${state.disabled.includes(s.name)?'':'checked'} aria-label="启用${h(s.name)}"></label>`).join('')}</section><section class="settings-card"><h2>手机安装</h2><p>安卓下载 APK 后安装。iPhone 下载 unsigned IPA 后，需要自行签名才能安装。安装包内置页面，运行不依赖电脑。</p><a class="primary link-button" href="https://github.com/yifanchen12/-txt-/releases/latest" target="_blank" rel="noreferrer">前往 GitHub 下载 ↗</a><p class="muted">${native?'当前运行于手机应用内。':'当前为网页模式；联网书目需要配套网页服务，手机原生应用直接连接书源。'}</p></section><section class="settings-card"><h2>本地数据</h2><p>正文、阅读进度与阅读设置只保存在本机。仅使用你有权下载和保存的内容。</p><button class="outline" data-action="backup">导出书库备份</button><label class="outline link-button">恢复备份<input type="file" id="restore-backup" accept=".json,application/json" hidden></label></section>`;}

async function runSearch(){
  const q=state.query.trim();if(!q)return;searchController?.abort();const controller=searchController=new AbortController();
  state.search=[];state.searching=true;state.hasSearch=true;state.searchedQuery=q;state.searchStatus='正在搜索已启用的书源…';render();
  try{const result=await searchBooks(q,{signal:controller.signal,onUpdate:(books,progress)=>{if(searchController!==controller)return;state.search=books;state.searchStatus=`找到 ${books.length} 本 · 已检索 ${progress.checked}/${progress.total} 个源${progress.errors.length?` · ${progress.errors.length} 个源暂时无法连接`:''}`;render();}});if(searchController!==controller)return;state.search=result.books;}
  catch(e){if(e.name!=='AbortError')report(e);}
  finally{if(searchController===controller){state.searching=false;render();}}
}
async function refreshRankings(){
  if(rankLoading){rankController.abort();rankLoading=false;render();return;}
  const controller=rankController=new AbortController();rankLoading=true;for(const p of Object.keys(PLATFORMS))state.ranks[p]={...state.ranks[p],loading:true,error:''};render();
  await Promise.allSettled(Object.keys(PLATFORMS).map(async p=>{
    try{const result=await loadRanking(p,{signal:controller.signal,onUpdate:r=>{if(rankController!==controller)return;state.ranks[p]={...r,loading:true};render();}});if(rankController===controller)state.ranks[p]={...result,loading:false};}
    catch(e){if(rankController===controller)state.ranks[p]={...state.ranks[p],loading:false,error:e.name==='AbortError'?'已停止刷新':e.message};}
    render();
  }));
  if(rankController===controller){rankLoading=false;render();}
}
async function importText(file){
  try{if(file.size>80*1024*1024)throw new Error('单本文件超过 80 MB，请先拆分后导入');const text=decodeText(new Uint8Array(await file.arrayBuffer()));if(!text.trim())throw new Error('文件没有正文');
    const [title,author='']=file.name.replace(/\.txt$/i,'').split(' - ');const book={title,author,genre:'本地导入',status:'本地文件',cover:'',characters:text.length};book.id=bookId(book);
    if(state.library.some(b=>b.id===book.id)){toast(`《${title}》已在书架中`);return;}
    await saveBook(book,text);await navigator.storage?.persist?.();state.library=await listBooks();state.route='library';render();toast(`《${title}》已保存，可以离线阅读`);
  }catch(e){report(e);}
}
async function openBook(id){
  const local=state.library.find(b=>b.id===id);if(local){await readBook(id);return;}
  const book=state.bookMap.get(id);if(!book)return;
  const dialog=document.createElement('dialog');dialog.className='book-dialog';
  dialog.innerHTML=`<button class="dialog-close quiet" aria-label="关闭详情">×</button><div class="detail-top">${cover(book)}<div><span class="eyebrow">${h(PLATFORMS[book.platform]?.name||book.source||'小说')}</span><h2>${h(book.title)}</h2><p>${h(book.author||'作者未知')}</p><span class="tag">${h(book.genre||'小说')}</span> <span class="tag">${h(book.status||'状态待核对')}</span></div></div><p class="detail-description">${h(book.description||'保存这本书，留待有空时慢慢阅读。')}</p><p class="detail-status" role="status">${h(book.source?`下载源：${book.source}`:'下载前会核对书名、作者与正文来源。')}</p><button class="primary download-start">下载并保存到本机 ${icon('download')}</button><p class="detail-note">完整下载后加入本地书架。可随时导出 TXT。</p>`;
  document.body.append(dialog);dialog.showModal();dialog.querySelector('.dialog-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.querySelector('.download-start').onclick=()=>{dialog.close();startDownload(book);};
}
async function startDownload(book){
  if(state.jobs.get(book.id)?.status==='running'){toast('这本书正在下载');return;}
  const controller=new AbortController(),job={book,status:'running',controller,label:'正在核对正文来源',done:0,total:0};state.jobs.set(book.id,job);state.route='downloads';render();
  try{
    let candidate=book;
    if(!((await sources()).some(s=>s.name===candidate.source)))candidate={...candidate,sourceConfig:undefined,prepared:undefined};
    if(!candidate.sourceConfig)candidate=await resolveBook(book,controller.signal);
    if(!candidate)throw new Error('已启用书源中未找到可下载的完整正文');
    const result=await downloadBook(candidate,{signal:controller.signal,onProgress:p=>{Object.assign(job,p);if(state.route==='downloads')render();}});
    if(controller.signal.aborted)throw new DOMException('操作已取消','AbortError');
    result.book.characters=result.text.length;await saveBook(result.book,result.text);await navigator.storage?.persist?.();
    job.status='done';job.book=result.book;state.library=await listBooks();toast(`《${book.title}》已完整保存到本机`);
  }catch(e){job.status=e.name==='AbortError'?'cancelled':'failed';job.error=e.message;}
  finally{render();}
}
async function readBook(id){try{const b=state.library.find(b=>b.id===id);if(!b)throw new Error('书籍尚未保存到当前设备');const reader=new Reader({onClose:async()=>{state.library=await listBooks();render();},onError:report});await reader.open(b);}catch(e){report(e);}}
async function exportFile(name,text,type='text/plain'){
  if(native){const {Filesystem,Directory,Encoding}=await import('@capacitor/filesystem');const {Share}=await import('@capacitor/share');const safe=name.replace(/[\\/:*?"<>|]/g,'_');const result=await Filesystem.writeFile({path:safe,data:text,directory:Directory.Cache,encoding:Encoding.UTF8});await Share.share({title:name,files:[result.uri],dialogTitle:'保存或分享文件'});}
  else{const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
async function backup(){try{const books=[];for(const b of state.library)books.push({book:b,text:await getText(b.id)});await exportFile(`拾页书库-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({format:'shiye-backup-v1',books}),'application/json');}catch(e){report(e);}}
app.addEventListener('click',async e=>{
  const el=e.target.closest('button,a,[data-action]');if(!el)return;
  if(el.dataset.route){state.route=el.dataset.route;render();window.scrollTo({top:0});}
  if(el.dataset.platform){state.platform=el.dataset.platform;state.route='rankings';render();window.scrollTo({top:0});}
  if(el.dataset.book)openBook(el.dataset.book).catch(report);
  if(el.dataset.read)readBook(el.dataset.read);
  if(el.dataset.cancel){state.jobs.get(el.dataset.cancel)?.controller.abort();toast('正在停止下载');}
  if(el.dataset.export){const b=state.library.find(x=>x.id===el.dataset.export);try{await exportFile(`${b.title} - ${b.author||'佚名'}.txt`,await getText(b.id));}catch(e){report(e);}}
  if(el.dataset.delete){const b=state.library.find(x=>x.id===el.dataset.delete);if(confirm(`从本机移除《${b.title}》及其阅读进度？`)){await deleteBook(b.id);state.library=await listBooks();render();}}
  const action=el.dataset.action;
  if(action==='import')app.querySelector('#import-txt').click();
  if(action==='settings'){state.route='settings';render();}
  if(action==='refresh')refreshRankings();
  if(action==='backup')backup();
  if(action==='paste'){
    const dialog=document.createElement('dialog');dialog.className='book-dialog paste-dialog';
    dialog.innerHTML='<form><div class="panel-title"><h2>导入正文</h2><button class="quiet" type="button" data-close>取消</button></div><label>书名<input name="title" aria-label="导入书名" required maxlength="100" placeholder="给这本书起个名字"></label><label>正文<textarea name="text" aria-label="导入小说正文" required placeholder="粘贴你想保存在本机的小说正文"></textarea></label><button type="submit" class="primary">保存到本地书架</button></form>';
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target),file=new File([String(data.get('text'))],String(data.get('title'))+'.txt',{type:'text/plain'});dialog.close();await importText(file);};
  }
  if(action==='cancel-search'){searchController?.abort();state.searching=false;state.searchStatus+=' · 已停止';render();}
  if(action==='clear-search'){state.hasSearch=false;state.query='';state.search=[];render();}
});
app.addEventListener('change',async e=>{
  if(e.target.id==='library-sort'){state.sort=e.target.value;render();}
  if(e.target.dataset.source){state.disabled=e.target.checked?state.disabled.filter(n=>n!==e.target.dataset.source):[...state.disabled,e.target.dataset.source];await setSetting('disabledSources',state.disabled);toast('书源设置已保存');}
  if(e.target.id==='restore-backup'){
    try{const file=e.target.files[0];if(!file)return;if(file.size>250*1024*1024)throw new Error('备份文件过大');const data=JSON.parse(await file.text());if(data.format!=='shiye-backup-v1'||!Array.isArray(data.books))throw new Error('这不是拾页书库备份');
      for(const item of data.books){if(typeof item.text!=='string'||typeof item.book?.title!=='string')throw new Error('备份书籍格式不正确');const b={...item.book,id:bookId(item.book),characters:item.text.length};await saveBook(b,item.text);}
      state.library=await listBooks();state.route='library';render();toast('书库备份已恢复');
    }catch(e){report(e);}
  }
});
async function boot(){
  try{state.library=await listBooks();state.disabled=await getSetting('disabledSources')||[];
    for(const p of Object.keys(PLATFORMS)){const cached=await getCache(`rank-${p}`);if(cached)state.ranks[p]={...cached,stale:true};}
  }catch(e){report(e);}
  render();
  if(!native&&'serviceWorker'in navigator&&!import.meta.env.DEV)navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(()=>{});
  refreshRankings();
}
boot();
