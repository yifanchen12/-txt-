import './style.css';
import './shell.css';
import {loading,busy} from './loading.js';
import {verifiedBatch} from './verified-feed.js';
import {PLATFORMS,loadRanking,searchBooks,resolveBook,downloadBook,defaultSources,sources} from './catalog.js';
import {native} from './network.js';
import {bookId,escapeHTML as h,coverPlaceholder,decodeText,isPlaceholderCover} from './core.js';
import {listBooks,saveBook,getText,deleteBook,getSetting,setSetting,getCache} from './storage.js';
import {Reader} from './reader.js';
import {CATEGORIES,DiscoveryFeed,matchesCategory} from './discovery.js';

const icons={book:'<path d="M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/><path d="M12 6v15"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',shelf:'<path d="M3 21h18M5 4h4v14H5Zm8 0h4v14h-4Zm5 1 3-1 3 14-3 1Z"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',settings:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>'};
const icon=name=>`<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.book}</svg>`;
const app=document.querySelector('#app');
const state={route:'discover',platform:'all',ranks:{},library:[],recommendations:[],search:[],query:'',searching:false,searchStatus:'',searchErrors:[],searchTotal:0,jobs:new Map(),bookMap:new Map(),disabled:[],sort:'recent'};
const discovery={check:null,channel:'all',genre:'all',engine:new DiscoveryFeed(),loading:false,hasMore:true,error:'',paused:false,emptyPages:0,generation:0};
let feedObserver,feedController;
function bindDiscovery(){
  feedObserver?.disconnect();
  const sentinel=app.querySelector('#feed-sentinel');
  if(!sentinel||!discovery.hasMore||discovery.loading||discovery.error||discovery.paused)return;
  feedObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))loadDiscovery();},{rootMargin:'500px 0px'});feedObserver.observe(sentinel);
}
async function loadDiscovery(){
  if(discovery.loading||!discovery.hasMore)return;
  const generation=discovery.generation,engine=discovery.engine;
  const controller=feedController=new AbortController();discovery.loading=true;discovery.check=null;discovery.error='';discovery.paused=false;render();
  try{
    const page=await engine.next({signal:controller.signal,exclude:state.recommendations.map(b=>b.id)});
    if(generation!==discovery.generation)return;
    const result=await verifiedBatch(page.books,{signal:controller.signal,
      onBook:book=>{if(generation!==discovery.generation)return;if(!state.recommendations.some(b=>b.id===book.id))state.recommendations.push(book);render();},
      onProgress:progress=>{if(generation!==discovery.generation)return;discovery.check=progress;render();}
    });
    if(generation!==discovery.generation)return;
    discovery.hasMore=page.hasMore;
    discovery.emptyPages=result.books.length?0:discovery.emptyPages+1;discovery.paused=discovery.emptyPages>=2;
  }catch(error){if(generation!==discovery.generation)return;if(error.name!=='AbortError')discovery.error=error.message;}
  finally{if(generation===discovery.generation){discovery.loading=false;render();}}
}
function changeDiscovery(channel,genre='all'){
  feedController?.abort();discovery.generation++;Object.assign(discovery,{channel,genre,engine:new DiscoveryFeed({channel,genre}),loading:false,check:null,hasMore:true,error:'',paused:false,emptyPages:0});
  state.resetAnchor=true;render();app.querySelector('.browse-filters')?.scrollIntoView({block:'start',behavior:'auto'});loadDiscovery();
}

let searchController,rankController,rankLoading=false,toastTimer,pendingRender=false;
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5000);}
const report=e=>toast(e?.name==='QuotaExceededError'?'本机存储空间不足，请导出备份后清理书库。':e.message||String(e));
function remember(b){state.bookMap.set(b.id||bookId(b),b);return b.id||bookId(b);}
function cover(b,cls=''){const id=remember(b);return `<img class="cover ${cls}" data-cover="${h(id)}" src="${h((!isPlaceholderCover(b.cover)&&b.cover)||coverPlaceholder(b))}" alt="《${h(b.title)}》封面" width="120" height="170" loading="lazy" referrerpolicy="no-referrer">`;}
function empty(title,body,action=''){return `<div class="empty"><div class="empty-icon">${icon('book')}</div><h3>${h(title)}</h3><p>${h(body)}</p>${action}</div>`;}
function navigation(){return [['discover','grid','发现'],['rankings','book','排行榜'],['library','shelf','本地书架'],['downloads','download','下载']].map(([route,i,label])=>`<button data-route="${route}" class="nav-item ${state.route===route?'active':''}" ${state.route===route?'aria-current="page"':''}>${icon(i)}<span>${label}</span>${route==='downloads'&&[...state.jobs.values()].some(j=>j.status==='running')?'<i class="notification-dot"></i>':''}</button>`).join('');}
function render(){
  if(document.activeElement?.id==='search-input'){pendingRender=true;return;}
  pendingRender=false;
  const anchor=state.route==='discover'&&!state.resetAnchor&&window.scrollY>300?[...app.querySelectorAll('[data-card-id]')].find(el=>{const r=el.getBoundingClientRect();return r.bottom>200&&r.top<innerHeight;}):null;
  const anchorId=anchor?.dataset.cardId,anchorTop=anchor?.getBoundingClientRect().top;state.resetAnchor=false;
  const focused=document.activeElement?.id,selection=focused==='search-input'?document.activeElement.selectionStart:null;
  const routeName={discover:'发现好书',rankings:'热门榜单',library:'我的书架',downloads:'下载中心',settings:'书源与应用'}[state.route];
  app.innerHTML=`<aside class="app-sidebar"><button class="brand" data-route="discover" aria-label="拾页首页"><img src="${import.meta.env.BASE_URL}icon.svg" width="42" height="42" alt=""><span><strong>拾页</strong><small>把故事带在身边</small></span></button><div class="nav-caption">我的阅读空间</div><nav class="desktop-nav" aria-label="主导航">${navigation()}</nav><div class="sidebar-bottom"><div class="sidebar-library">${icon('book')}<span><strong>${state.library.length} 本本地藏书</strong><small>离线，也能继续故事</small></span></div><button class="nav-item ${state.route==='settings'?'active':''}" data-action="settings">${icon('settings')}<span>书源与设置</span></button><a class="sidebar-download" href="https://github.com/yifanchen12/shiye/releases/latest" target="_blank" rel="noreferrer">下载手机应用 ↗</a></div></aside><div class="app-workspace"><header class="site-header"><div class="header-inner"><button class="mobile-brand" data-route="discover"><img src="${import.meta.env.BASE_URL}icon.svg" width="32" height="32" alt="">拾页</button><div class="location-label">阅读空间 <span>/</span> <strong>${routeName}</strong></div><div class="header-actions"><button data-action="import" class="quiet header-import">＋ 导入书籍</button><button class="header-settings" data-action="settings" aria-label="书源设置">${icon('settings')}</button></div></div></header><main id="main">${state.route==='discover'?discover():state.route==='rankings'?rankings():state.route==='library'?library():state.route==='downloads'?downloads():settings()}</main><footer class="site-footer"><span>拾页 · 在字里行间，留一点自己的时间</span><a href="https://github.com/yifanchen12/shiye" target="_blank" rel="noreferrer">拾页 GitHub ↗</a></footer></div><nav class="mobile-nav" aria-label="手机导航">${navigation()}</nav><input id="import-txt" type="file" accept=".txt,text/plain" multiple hidden>`;
  if(anchorId){const replacement=[...app.querySelectorAll('[data-card-id]')].find(el=>el.dataset.cardId===anchorId);if(replacement)window.scrollBy({top:replacement.getBoundingClientRect().top-anchorTop,behavior:'auto'});}
  bindDiscovery();
  app.querySelectorAll('[data-cover]').forEach(img=>{img.addEventListener('error',()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src=coverPlaceholder(state.bookMap.get(img.dataset.cover)||{});});});
  app.querySelector('#search-input')?.addEventListener('input',e=>state.query=e.target.value);
  app.querySelector('#search-input')?.addEventListener('blur',()=>{if(pendingRender)setTimeout(()=>{if(pendingRender)render();},180);});
  app.querySelector('#search-form')?.addEventListener('submit',e=>{e.preventDefault();runSearch();});
  app.querySelector('#import-txt')?.addEventListener('change',async e=>{for(const f of e.target.files)await importText(f);});
  if(focused==='search-input'){const input=app.querySelector('#search-input');input?.focus({preventScroll:true});if(selection!==null)input?.setSelectionRange(selection,selection);}
}
function searchBar(){return `<form id="search-form" class="search-box" role="search"><label class="sr-only" for="search-input">搜索小说书名</label>${icon('search')}<input id="search-input" name="q" type="search" autocomplete="off" placeholder="搜索书名，找一本想读的书" value="${h(state.query)}" required maxlength="100"><button type="submit" class="primary">${state.searching?'重新搜索':'搜索好书'}</button></form>`;}
function discover(){
  const books=recommendationBooks();
  return `<section class="hero discovery-hero"><div class="hero-copy"><div class="hero-kicker"><span></span> 为喜欢的故事，留一页</div><h1>下一段故事，<br>从这里开始<span>。</span></h1><p>发现，收藏，然后慢慢读。<br class="mobile-break">你的私人书房，随时为你敞开。</p><button class="hero-shelf" data-route="library">走进我的书架 ${icon('arrow')}</button></div><div class="hero-art" aria-hidden="true"><span class="hero-orbit orbit-one"></span><span class="hero-orbit orbit-two"></span><div class="hero-paper paper-back"><i></i><i></i><i></i></div><div class="hero-paper paper-front"><small>SHIYE</small><strong>故事<br>未完待续</strong><span>翻开，就有新的世界</span></div><span class="hero-star">✦</span></div></section><section class="search-section">${searchBar()}<div class="search-hint"><span>起点</span><i></i><span>番茄</span><i></i><span>晋江</span><em>保存到本机，随时接着读</em></div></section>${categoryFilters()}${state.query&&state.searching||state.hasSearch?searchResults():''}${continueReading()}<section class="section ranking-section"><div class="section-heading"><div><div class="eyebrow">人气正在这里</div><h2>三站热榜</h2></div><button class="outline compact" data-action="refresh">${rankLoading?'停止刷新':'刷新榜单'} ↻</button></div><p class="section-intro">保留官方名次，只显示当前已实测正文的完本作品。</p><div class="ranking-grid">${Object.keys(PLATFORMS).map(p=>rankingBoard(p)).join('')}</div></section><section class="section recommendations" aria-label="持续推荐书目"><div class="section-heading"><div><div class="eyebrow">翻开下一本</div><h2>为你发现</h2></div><span class="feed-count"><i></i> ${books.length} 本已实测正文</span></div><p class="verification-note">推荐前读取目录，并实测首、中、末章；TXT 源实取文件。下载时仍会逐章检查，完整后才入库。</p><div class="book-grid" id="discovery-books">${books.map(b=>bookCard(b)).join('')}</div>${!books.length?`<div class="filter-empty"><h3>看看这个分类的新故事</h3><p>${discovery.loading?'正在为你核验候选书籍，通过后会陆续出现在这里。':'细分类依据书目标签；只标为“言情”的书会放在女频「言情」中。'}</p></div>`:''}<div class="feed-more" id="feed-sentinel" role="status">${discovery.loading?loading({label:discovery.check?'正在检验新书能否下载':'正在翻找下一页好书',detail:discovery.check?`已检查 ${discovery.check.checked} 本 · ${discovery.check.rejected} 本暂不可用，已跳过`:'先读取书目，再实测正文；通过即展示',done:discovery.check?.checked,total:discovery.check?.total}):discovery.error?`<p>${h(discovery.error)}</p><button class="outline" data-action="more-books">重新加载</button>`:discovery.hasMore?`<span>${discovery.paused?'暂未找到更多这个细分类，可继续查找或切换「全部」。':'继续往下，还会有新书。'}</span><button class="outline" data-action="more-books">继续加载</button>`:'<span>当前来源的书目已看完，换个分类继续逛。</span>'}</div></section>`;
}
function categoryFilters(){
  const categories=CATEGORIES[discovery.channel]||CATEGORIES.all;
  return `<section class="browse-filters" aria-label="小说分类"><div class="filter-top"><div class="channel-tabs" role="group" aria-label="男女频分类">${[['all','全部'],['male','男频'],['female','女频']].map(([id,label])=>`<button data-channel="${id}" aria-pressed="${discovery.channel===id}">${label}</button>`).join('')}</div><span class="category-caption">按题材，找对胃口的故事</span></div><div class="genre-tabs" role="group" aria-label="小说题材">${categories.map(c=>`<button data-genre="${c.id}" aria-pressed="${discovery.genre===c.id}">${c.label}</button>`).join('')}</div></section>`;
}
function rankingBoard(platform,full=false){
  const p=PLATFORMS[platform],r=state.ranks[platform]||{},items=r.books||[];
  return `<article class="ranking-board ${full?'expanded':''}" style="--platform-color:${p.color}"><div class="board-heading"><div><span class="platform-symbol">${p.name[0]}</span><h3>${p.name}<small>${p.label} · 可下载完本</small></h3></div><a href="${p.url}" target="_blank" rel="noreferrer" aria-label="查看${p.name}官方榜单">↗</a></div><ol class="ranking-list">${items.slice(0,full?20:3).map(b=>`<li><span class="rank-number ${b.rank<=3?'top':''}">${String(b.rank).padStart(2,'0')}</span><button class="rank-book" data-book="${h(remember(b))}">${cover(b)}<span class="rank-book-copy"><strong>${h(b.title)}</strong><small>${h(b.author||'作者未知')}</small><em>${h(b.genre||'小说')} · 正文已实测</em></span></button></li>`).join('')}</ol>${!items.length?`<div class="rank-empty">${r.loading?loading({label:'正在核对下载源',detail:'先查榜单，再实测正文',compact:true}):`<p>${h(r.error||'暂未匹配到可下载的完本作品')}</p>`}<small>${r.checked!==undefined?`已核对 ${r.checked}/${r.rawCount||'…'} 本`:r.error?'可以稍后重试，或先搜索书名':'尚未更新'}</small></div>`:''}<div class="board-footer"><span>${r.loading?loading({label:`核对中 ${r.checked||0}/${r.rawCount||'…'}`,compact:true}):r.time?`${r.stale?'缓存 · ':''}${new Date(r.time).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 更新`:'等待更新'}</span><button data-platform="${platform}" class="text-button">查看完整榜单 →</button></div></article>`;
}
function rankings(){return `<section class="page-title"><div class="eyebrow">WHAT'S BEING READ</div><h1>排行榜<span>.</span></h1><p>官方热度，有据可循。只收录已匹配到正文的完本作品。</p></section><div class="tab-row">${[['all','全部榜单'],...Object.entries(PLATFORMS).map(([k,v])=>[k,v.name])].map(([k,v])=>`<button data-platform="${k}" class="tab ${state.platform===k?'selected':''}">${v}</button>`).join('')}<button class="text-button push-right" data-action="refresh">${rankLoading?'停止刷新':'刷新'} ↻</button></div><div class="ranking-grid ${state.platform!=='all'?'single-ranking':''}">${(state.platform==='all'?Object.keys(PLATFORMS):[state.platform]).map(p=>rankingBoard(p,true)).join('')}</div>`;}
function bookCard(b){const local=state.library.some(x=>x.id===b.id),platform=PLATFORMS[b.platform]?.name;return `<article class="book-card" data-card-id="${h(b.id)}"><button class="cover-button" data-book="${h(remember(b))}">${cover(b)}<span class="cover-action">${local?'继续阅读':'查看这本书'} ${icon('arrow')}</span></button><button class="book-title" data-book="${h(b.id)}">${h(b.title)}</button><p class="book-author">${h(b.author||'作者未知')}</p><div class="book-tags">${platform?`<span>${platform}</span>`:''}<span>${h(b.genre||'小说')}</span>${local?'<span class="saved-tag">已保存</span>':b.verification?'<span class="verified-tag">✓ 正文已实测</span>':''}</div></article>`;}
function recommendationBooks(){
  return state.recommendations.filter(b=>b.verification&&matchesCategory(b,discovery));
}
function continueReading(){const b=state.library.find(x=>x.lastRead||x.offset>0);if(!b)return '';return `<section class="continue-card">${cover(b)}<div><div class="eyebrow">接着上次的故事</div><h3>${h(b.title)}</h3><p>${h(b.author)} · 阅读到 ${Math.round(b.offset/Math.max(b.characters||1,1)*100)}%</p></div><button class="primary" data-read="${h(remember(b))}">继续阅读 ${icon('arrow')}</button></section>`;}
function searchResults(){
 const allFailed=!state.searching&&state.searchTotal>0&&state.searchErrors.length===state.searchTotal;
 const problem=state.searchErrors.length?`<details class="source-errors"><summary>查看 ${state.searchErrors.length} 个源的连接问题</summary><ul>${state.searchErrors.map(e=>`<li><strong>${h(defaultSources.download_sources.find(s=>s.name===e.source)?.base_url?new URL(defaultSources.download_sources.find(s=>s.name===e.source).base_url).hostname:e.source)}</strong><span>${h(e.message)}</span></li>`).join('')}</ul></details>`:'';
 return `<section class="section search-results"><div class="section-heading"><h2>“${h(state.searchedQuery||state.query)}” 的搜索结果</h2><button class="text-button" data-action="${state.searching?'cancel-search':'clear-search'}">${state.searching?'停止搜索':'收起结果'}</button></div>${state.searching?loading({label:'正在各个书源找书',detail:state.searchStatus,compact:true}):`<p class="muted" role="status">${h(state.searchStatus)}</p>`}${problem}<div class="book-grid">${state.search.map(b=>bookCard(b)).join('')}</div>${!state.search.length&&!state.searching?empty(allFailed?'下载源连接失败，搜索未完成':'暂时没有找到这本书',allFailed?'无法判断有没有这本书。检查网络或代理后，再试一次。':'试试完整书名，也可以查看各书源的连接状态。','<button class="outline" data-action="retry-search">重新搜索</button>'):''}</section>`;
}
function library(){const books=[...state.library];if(state.sort==='title')books.sort((a,b)=>a.title.localeCompare(b.title,'zh'));return `<section class="page-title"><div class="eyebrow">YOUR LITTLE LIBRARY</div><h1>本地书架<span>.</span></h1><p>${books.length?`${books.length} 本书，已经在这台设备上。断网，也有故事陪你。`:'把喜欢的书存下来，慢慢读。'}</p></section><div class="library-toolbar"><button class="primary" data-action="import">＋ 导入 TXT</button><button class="outline" data-action="paste">粘贴正文</button><button class="outline" data-action="backup">备份书库</button><label class="sort-label">排序 <select id="library-sort"><option value="recent" ${state.sort==='recent'?'selected':''}>最近阅读</option><option value="title" ${state.sort==='title'?'selected':''}>按书名</option></select></label></div><div class="library-grid">${books.map(b=>`<article class="library-card">${cover(b)}<div><h3>${h(b.title)}</h3><p>${h(b.author||'本地导入')}</p><small>${(b.bytes/1024).toFixed(0)} KB · ${b.offset?`${Math.min(100,Math.round(b.offset/Math.max(1,b.characters)*100))}%`:'尚未开始'}</small><div class="library-actions"><button class="primary small" data-read="${h(remember(b))}">${b.offset?'继续阅读':'开始阅读'}</button><button class="quiet" data-export="${h(b.id)}" aria-label="导出${h(b.title)}">导出</button><button class="quiet danger" data-delete="${h(b.id)}" aria-label="移除${h(b.title)}">移除</button></div></div></article>`).join('')}</div>${!books.length?empty('你的第一本书，从这里开始','下载小说，或导入本机 TXT 文件。书籍正文、封面和阅读进度都会保存在当前设备。'):''}<p class="storage-note">书库保存在当前应用或浏览器内。卸载应用、清理网站数据前，请先导出或备份。</p>`;}
function downloads(){const jobs=[...state.jobs.values()].reverse();return `<section class="page-title"><div class="eyebrow">STORIES TO GO</div><h1>下载<span>.</span></h1><p>下载与阅读都在本机完成。</p></section><div class="download-list">${jobs.map(j=>`<article class="download-item">${cover(j.book)}<div class="download-copy"><h3>${h(j.book.title)}</h3><p>${h(j.status==='done'?'已完整保存到本机':j.status==='failed'?j.error:j.status==='cancelled'?'已取消，未加入书库':j.label||'正在连接书源')}</p>${j.status==='running'?`${loading({label:j.total?'正在把故事装进书架':'正在核对下载入口',detail:j.total?'按章节获取，完整后保存':'连接书源并检查正文',done:j.done,total:j.total,compact:true})}`:''}</div>${j.status==='running'?`<button class="outline" data-cancel="${h(j.book.id)}">取消</button>`:j.status==='done'?`<button class="primary" data-read="${h(j.book.id)}">阅读</button>`:`<button class="outline" data-book="${h(j.book.id)}">重试</button>`}</article>`).join('')}</div>${!jobs.length?empty('这里等着下一本好书','在排行榜或搜索结果中打开小说，选择“下载并保存”。','<button class="outline" data-route="discover">去找好书</button>'):''}`;}
function settings(){return `<section class="page-title"><div class="eyebrow">MAKE IT YOURS</div><h1>书源与应用<span>.</span></h1><p>应用直接连接已启用的公开书源。来源是否可用取决于当前网络和站点状态。</p></section><section class="settings-card"><h2>下载源</h2>${defaultSources.download_sources.filter(s=>s.type!=='direct_from_candidate').map(s=>`<label class="source-toggle"><span><strong>${h(s.name)}</strong><small>${h(new URL(s.base_url).hostname)}</small></span><input type="checkbox" data-source="${h(s.name)}" ${state.disabled.includes(s.name)?'':'checked'} aria-label="启用${h(s.name)}"></label>`).join('')}</section><section class="settings-card"><h2>下载安装</h2><p>Windows 下载 ZIP，解压后双击拾页.exe。安卓下载 APK 后安装。iPhone 下载 unsigned IPA 后，需要自行签名才能安装。安装包内置页面，运行不依赖电脑。</p><a class="primary link-button" href="https://github.com/yifanchen12/shiye/releases/latest" target="_blank" rel="noreferrer">前往 GitHub 下载 ↗</a><p class="muted">${globalThis.shiyeDesktop?'当前为 Windows 本机程序，直接连接书源，无需网页服务。':native?'当前运行于手机应用内。':'当前为网页模式；联网书目需要配套网页服务，手机原生应用直接连接书源。'}</p></section><section class="settings-card"><h2>本地数据</h2><p>正文、阅读进度与阅读设置只保存在本机。仅使用你有权下载和保存的内容。</p><button class="outline" data-action="backup">导出书库备份</button><label class="outline link-button">恢复备份<input type="file" id="restore-backup" accept=".json,application/json" hidden></label></section>`;}

async function runSearch(){
  const q=state.query.trim();if(!q)return;app.querySelector('#search-input')?.blur();searchController?.abort();const controller=searchController=new AbortController();
  state.search=[];state.searchErrors=[];state.searchTotal=0;state.searching=true;state.hasSearch=true;state.searchedQuery=q;state.searchStatus='正在搜索已启用的书源…';render();
  try{const result=await searchBooks(q,{signal:controller.signal,onUpdate:(books,progress)=>{if(searchController!==controller)return;state.search=books;state.searchErrors=progress.errors;state.searchTotal=progress.total;state.searchStatus=progress.checked===progress.total&&progress.errors.length===progress.total?'搜索未完成：全部下载源连接失败':`已检索 ${progress.checked}/${progress.total} 个源 · ${books.length?`找到 ${books.length} 本`:'正在查找匹配书目'}${progress.errors.length?` · ${progress.errors.length} 个源连接失败`:''}`;render();}});if(searchController!==controller)return;state.search=result.books;}
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
    const active=await sources();
    let candidates=[book,...(book.alternatives||[])].filter(b=>b.sourceConfig&&active.some(s=>s.name===b.source));
    if(!candidates.length){const resolved=await resolveBook(book,controller.signal);if(resolved)candidates=[resolved];}
    if(!candidates.length)throw new Error('已启用书源中未找到可下载的完整正文');
    let result,lastError;
    for(let i=0;i<candidates.length;i++){
      if(controller.signal.aborted)throw new DOMException('操作已取消','AbortError');
      try{
        job.label=`正在尝试 ${candidates[i].source}（${i+1}/${candidates.length}）`;render();
        result=await downloadBook(candidates[i],{signal:controller.signal,recheck:true,fallbacks:candidates.filter(b=>b.source!==candidates[i].source),onProgress:p=>{Object.assign(job,p);if(state.route==='downloads')render();}});
        break;
      }catch(error){if(error.name==='AbortError')throw error;lastError=error;}
    }
    if(!result)throw lastError||new Error('这些来源均未能完成下载，请稍后重试');
    if(controller.signal.aborted)throw new DOMException('操作已取消','AbortError');
    result.book.characters=result.text.length;await saveBook(result.book,result.text);await navigator.storage?.persist?.();
    job.status='done';job.book=result.book;state.library=await listBooks();toast(`《${book.title}》已完整保存到本机`);
  }catch(e){job.status=e.name==='AbortError'?'cancelled':'failed';job.error=e.message;}
  finally{render();}
}
async function readBook(id){const stop=busy('正在翻开这本书','整理正文与阅读进度');try{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const b=state.library.find(b=>b.id===id);if(!b)throw new Error('书籍尚未保存到当前设备');const reader=new Reader({onClose:async()=>{state.library=await listBooks();render();},onError:report});await reader.open(b);}catch(e){report(e);}finally{stop();}}
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
  if(el.dataset.channel)changeDiscovery(el.dataset.channel);
  if(el.dataset.genre)changeDiscovery(discovery.channel,el.dataset.genre);
  const action=el.dataset.action;
  if(action==='more-books'){discovery.emptyPages=0;loadDiscovery();}
  if(action==='import')app.querySelector('#import-txt').click();
  if(action==='settings'){state.route='settings';render();}
  if(action==='refresh')refreshRankings();
  if(action==='retry-search')runSearch();
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
  if(e.target.dataset.source){state.disabled=e.target.checked?state.disabled.filter(n=>n!==e.target.dataset.source):[...state.disabled,e.target.dataset.source];await setSetting('disabledSources',state.disabled);toast('书源设置已保存');feedController?.abort();discovery.generation++;state.recommendations=[];Object.assign(discovery,{engine:new DiscoveryFeed(discovery),loading:false,hasMore:true,error:'',check:null});render();}
  if(e.target.id==='restore-backup'){
    try{const file=e.target.files[0];if(!file)return;if(file.size>250*1024*1024)throw new Error('备份文件过大');const data=JSON.parse(await file.text());if(data.format!=='shiye-backup-v1'||!Array.isArray(data.books))throw new Error('这不是拾页书库备份');
      for(const item of data.books){if(typeof item.text!=='string'||typeof item.book?.title!=='string')throw new Error('备份书籍格式不正确');const b={...item.book,id:bookId(item.book),characters:item.text.length};await saveBook(b,item.text);}
      state.library=await listBooks();state.route='library';render();toast('书库备份已恢复');
    }catch(e){report(e);}
  }
});
async function boot(){
  app.innerHTML=`<div class="boot-loading"><img src="${import.meta.env.BASE_URL}icon.svg" width="64" height="64" alt="拾页">${loading({label:'正在打开你的书房',detail:'读取本地藏书与设置'})}</div>`;
  try{state.library=await listBooks();state.disabled=await getSetting('disabledSources')||[];
    for(const p of Object.keys(PLATFORMS)){const cached=await getCache(`rank-${p}`);if(cached)state.ranks[p]={...cached,books:[],stale:true};}
  }catch(e){report(e);}
  render();
  if(!native&&'serviceWorker'in navigator&&!import.meta.env.DEV)navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(()=>{});
  refreshRankings();
}
boot();
