import defaults from './default-sources.json' with {type:'json'};
import qidianSnapshot from './qidian-snapshot.json' with {type:'json'};
import {text,request,coverData} from './network.js';
import {normalize,bookId,webURL,decodeText,sameBook,completed,assertNotAborted} from './core.js';
import {getSetting,getCache,setCache} from './storage.js';

export const PLATFORMS={qidian:{name:'起点',label:'畅销榜',url:'https://m.qidian.com/rank/hotsales/',color:'#a54231'},fanqie:{name:'番茄',label:'阅读榜',url:'https://fanqienovel.com/rank',color:'#c3693b'},jinjiang:{name:'晋江',label:'总分榜',url:'https://www.jjwxc.net/topten.php?orderstr=7',color:'#447761'}};
export const documentOf = html => new DOMParser().parseFromString(/^\s*(?:<!doctype|<html)/i.test(html)?html:`<html><head></head><body>${html}</body></html>`,'text/html');
const select=(node,selector)=>{try{return selector?node.querySelector(selector):null;}catch{return null;}};
const all=(node,selector)=>{try{return [...node.querySelectorAll(selector)];}catch{return [];}};
const value=(node,selector)=>select(node,selector)?.textContent.trim()||'';
function plain(node) {
  if(!node)return '';
  const copy=node.cloneNode(true);all(copy,'script,style,noscript,iframe,ins,.ads,.ad').forEach(n=>n.remove());
  return documentOf(copy.innerHTML.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6]|dd|dt)>/gi,'\n')).body.textContent.replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean).join('\n');
}
const regexValue=(str,pattern)=>{try{const m=pattern&&str.match(new RegExp(pattern,'m'));return (m?.[1]||m?.[0]||'').trim();}catch{return '';}};
const meta=(doc,...names)=>{for(const name of names){const n=select(doc,`meta[property="${name}"],meta[name="${name}"]`);if(n?.content)return n.content.trim();}return '';};
export function findCover(doc,url) {
  return webURL(meta(doc,'og:image','og:novel:image')||select(doc,'img.noveldefaultimage,.book-cover img,img.book-cover-img,#fmimg img,.book-img img,.cover img,.pic img,img[itemprop="image"]')?.getAttribute('data-src')||select(doc,'img.noveldefaultimage,.book-cover img,img.book-cover-img,#fmimg img,.book-img img,.cover img,.pic img,img[itemprop="image"]')?.getAttribute('src')||'',url);
}
function tidyTitle(title) {return title.replace(/^[《【]|[》】]$/g,'').replace(/(?:TXT|txt)电子书下载.*$|(?:TXT|txt)下载.*$/g,'').trim();}
export function parseSourceDetail(html,url,source,fallback={}) {
  const doc=documentOf(html),blob=plain(doc.body);
  let title=meta(doc,'og:novel:book_name')||value(doc,source.title_selector)||regexValue(blob,source.detail_title_regex||source.title_regex)||value(doc,'h1')||value(doc,'dd.bt h2');
  let author=meta(doc,'og:novel:author')||value(doc,source.author_selector)||regexValue(blob,source.detail_author_regex||source.author_regex)||regexValue(blob,'(?:小说作者|书籍作者|作者)\\s*[：:]\\s*([^\\s，,；;]+)');
  if(title.includes('《')) {const m=title.match(/《(.+?)》/);if(m)title=m[1];}
  if(!author)author=regexValue(plain(doc.body),'作者\\s*[：:]\\s*([^\\n]+)');
  author=author.replace(/^作\s*者\s*[：:]\s*/,'').trim();
  const status=meta(doc,'og:novel:status')||value(doc,source.status_selector)||regexValue(blob,source.detail_status_regex||source.status_regex)||regexValue(blob,'(?:状态|写作进度|小说状态)\\s*[：:]\\s*([^\\s，,]+)')||source.assume_status||'';
  const genre=meta(doc,'og:novel:category')||value(doc,source.genre_selector)||regexValue(blob,source.detail_genre_regex||source.genre_regex)||'小说';
  let downloadUrl=webURL(select(doc,source.download_link_selector)?.getAttribute('href')||'',url);
  if(!downloadUrl)for(const a of all(doc,'a[href]')){
    const href=webURL(a.getAttribute('href'),url),label=a.textContent.trim();
    if(/\.txt(?:\?|$)/i.test(href)&&/下载|TXT|txt/.test(label)){downloadUrl=href;break;}
  }
  const book={title:tidyTitle(title||fallback.title||''),author:author||fallback.author||'',genre,status,detailUrl:url,cover:findCover(doc,url),downloadUrl,source:source.name,sourceType:source.type,description:meta(doc,'description','og:description').slice(0,280)};
  book.id=bookId(book);return {book,doc};
}
export async function sources() {
  const disabled=await getSetting('disabledSources')||[];
  return defaults.download_sources.filter(s=>s.enabled&&s.authorized&&!disabled.includes(s.name));
}
export const defaultSources=defaults;
function searchSpec(source,q) {
  if(source.type==='direct_from_candidate')return null;
  if(source.type==='10000txt_search')return {url:source.search_url,method:'POST',body:new URLSearchParams({q}).toString(),selector:'ul.list-it h2 a[href]'};
  if(source.type==='7shutxt_search')return {url:source.search_url,method:'POST',body:new URLSearchParams({show:'title,zuozhe',keyboard:q,Submit:''}).toString(),selector:"a[href*='article-'],a[href*='ShowInfo.php']"};
  if(source.type==='txt80_search')return {url:source.search_url,method:'POST',body:new URLSearchParams({show:'title,softsay,softwriter',keyboard:q,Submit22:'',tbname:'download',tempid:'1'}).toString(),selector:"a[href*='/txt'][href$='.html']"};
  const template=source.search_url_template;if(!template)return null;
  const post=source.search_method==='post';
  return {url:template.replaceAll('{title}',encodeURIComponent(q)).replaceAll('{author}',''),method:post?'POST':'GET',body:post?new URLSearchParams({[source.search_field||'q']:q}).toString():undefined,selector:source.result_link_selector||'a[href]'};
}
export async function searchSource(source,q,signal,{limit=6}={}) {
  const spec=searchSpec(source,q);if(!spec)return [];
  const html=await text(spec.url,{...spec,signal}),doc=documentOf(html);
  const links=[];
  for(const a of all(doc,spec.selector)){
    let url=webURL(a.getAttribute('href'),source.base_url||spec.url);
    if(url.includes('ShowInfo.php')){const u=new URL(url);if(u.searchParams.has('classid')&&u.searchParams.has('id'))url=new URL(`/article-${u.searchParams.get('classid')}-${u.searchParams.get('id')}.html`,url).href;}
    if(url&&!links.some(item=>item.url===url))links.push({url,label:tidyTitle(a.textContent.trim()).replace(/^\[[^\]]{1,16}\]\s*/, '')});
    if(links.length>=(source.max_results||30))break;
  }
  links.sort((a,b)=>Number(normalize(b.label)===normalize(q))-Number(normalize(a.label)===normalize(q)));
  const selected=links.slice(0,limit);
  const books=[];
  for(let i=0;i<selected.length;i+=2){
    assertNotAborted(signal);
    const batch=await Promise.allSettled(selected.slice(i,i+2).map(async ({url})=>{
      const result=parseSourceDetail(await text(url,{signal}),url,source);
      if(!normalize(result.book.title).includes(normalize(q)))return null;
      return {...result.book,sourceConfig:source};
    }));
    for(const r of batch)if(r.status==='fulfilled'&&r.value)books.push(r.value);
  }
  return books;
}
export async function searchBooks(q,{signal,onUpdate=()=>{}}={}) {
  const list=(await sources()).filter(s=>s.type!=='direct_from_candidate');
  const results=new Map(),errors=[];let checked=0;
  for(let i=0;i<list.length;i+=3){
    assertNotAborted(signal);
    await Promise.all(list.slice(i,i+3).map(async s=>{
      try {for(const b of await searchSource(s,q,signal)){const old=results.get(b.id);if(!old)results.set(b.id,b);else{old.alternatives=[...(old.alternatives||[]),b];if(!old.cover)old.cover=b.cover;}}}
      catch(e){assertNotAborted(signal);errors.push({source:s.name,message:e.message});}
      onUpdate([...results.values()],{checked:++checked,total:list.length,errors:[...errors]});
    }));
  }
  return {books:[...results.values()],errors};
}
function embeddedState(html) {const m=html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s);try{return JSON.parse(m?.[1]||'{}');}catch{return {};}}
export function parseOfficial(platform,html) {
  const doc=documentOf(html),books=[];
  if(platform==='qidian'){
    let state={};try{state=JSON.parse(value(doc,'#vite-plugin-ssr_pageContext')||value(doc,'#__NEXT_DATA__')||'{}');}catch{/* handled by empty-state error */}
    const context=state.pageContext||state;
    const data=context.pageProps?.pageData||context.props?.pageProps?.pageData||{};
    const records=data.records||data.list?.records||[];
    for(const r of records)if(r.bid&&r.bName){const url=`https://m.qidian.com/book/${r.bid}/`;const img=all(doc,'img').find(n=>(n.getAttribute('data-src')||n.getAttribute('src')||'').includes(`/${r.bid}/`));books.push({title:r.bName,author:r.bAuth||'',genre:r.cat||'小说',description:r.desc||'',rank:Number(r.rankNum)||books.length+1,cover:webURL(img?.getAttribute('data-src')||img?.getAttribute('src')||'',url),detailUrl:url,status:r.state||''});}
  } else if(platform==='fanqie'){
    const rank=embeddedState(html).rank||{};
    for(const r of rank.book_list||[])if(r.bookId&&r.bookName)books.push({title:r.bookName,author:r.author||'',genre:r.category||'小说',description:r.abstract||'',rank:Number(r.currentPos)||books.length+1,cover:webURL(r.thumbUri),detailUrl:`https://fanqienovel.com/page/${r.bookId}`,status:String(r.creationStatus)==='0'?'完结':'连载',needsDetail:/[\ue000-\uf8ff]/u.test(r.bookName)});
  } else if(platform==='jinjiang'){
    for(const a of all(doc,'a[href*="onebook.php?novelid="]')){
      const row=a.closest('tr');if(!row)continue;
      const cells=all(row,'td'),rank=Number(cells[0]?.textContent.trim());
      if(!rank||!a.textContent.trim())continue;
      const title=a.getAttribute('title')||a.textContent.trim();
      if(books.some(b=>normalize(b.title)===normalize(title)))continue;
      books.push({title,author:value(row,'a[href*="oneauthor.php"]'),genre:cells[3]?.textContent.trim()||'言情',status:cells[4]?.textContent.trim()||'',description:documentOf(a.getAttribute('rel')||'').body.textContent.slice(0,240),rank,cover:'',detailUrl:webURL(a.getAttribute('href'),'https://www.jjwxc.net/')});
    }
  }
  return books.slice(0,20).map(b=>({...b,id:bookId(b),platform}));
}
export async function officialBooks(platform,signal) {
  const html=await text(PLATFORMS[platform].url,{signal});
  const books=parseOfficial(platform,html);
  if(!books.length){
    const doc=documentOf(html);
    if(doc.querySelector('script')&&plain(doc.body).length<20&&html.length<10000)throw new Error('官网当前只返回脚本页，未提供可读取的榜单；可查看官网或稍后刷新');
    throw new Error('官方榜单暂时无法解析，请稍后刷新');
  }
  // Public detail-page titles contain readable names even when ranking text uses a display font.
  for(let i=0;i<books.length;i+=3){
    await Promise.all(books.slice(i,i+3).map(async b=>{
      if(platform==='qidian')return;
      try {
        const d=documentOf(await text(b.detailUrl,{signal}));
        const title=value(d,'h1');if(title&&!/[\ue000-\uf8ff]/u.test(title))b.title=title;
        if(b.needsDetail&&/[\ue000-\uf8ff]/u.test(b.title)){
          const pageTitle=value(d,'title').split('完整版在线')[0];if(pageTitle&&!/[\ue000-\uf8ff]/u.test(pageTitle))b.title=pageTitle;
        }
        b.cover=findCover(d,b.detailUrl)||b.cover;b.id=bookId(b);
      }catch{assertNotAborted(signal);}
    }));
  }
  return books.filter(b=>!/[\ue000-\uf8ff]/u.test(b.title));
}
export async function resolveBook(wanted,signal,available) {
  const list=[...(available||await sources())].filter(s=>s.type!=='direct_from_candidate');
  // Try chapter catalogs first: availability can be checked without downloading a full book.
  list.sort((a,b)=>Number(b.type==='chapter_scraper')-Number(a.type==='chapter_scraper'));
  for(const s of list){
    assertNotAborted(signal);
    try {
      const results=await searchSource(s,wanted.title,signal,{limit:3});
      for(const b of results)if(sameBook(wanted,b)&&completed(b)){
        const prepared=await prepareDownload(b,signal);
        if(prepared)return {...b,...wanted,source:b.source,sourceType:b.sourceType,sourceConfig:s,prepared,cover:wanted.cover||b.cover,availability:'matched'};
      }
    }catch{assertNotAborted(signal);}
  }
  return null;
}
export async function loadRanking(platform,{signal,onUpdate=()=>{}}={}) {
  const cached=await getCache(`rank-${platform}`);
  if(cached?.books?.length)onUpdate({...cached,stale:true});
  let raw,time=Date.now(),stale=false,notice='';const books=[];
  try{raw=await officialBooks(platform,signal);}catch(error){
    assertNotAborted(signal);
    const fallback=cached?.raw?.length?{books:cached.raw,time:cached.time}:platform==='qidian'?qidianSnapshot:null;
    if(!fallback)throw error;
    raw=fallback.books;time=fallback.time;stale=true;notice=error.message;
  }
  onUpdate({books,raw,rawCount:raw.length,checked:0,time,stale,notice});
  const enabled=(await sources()).filter(s=>s.base_url&&s.type!=='direct_from_candidate');
  const checks=await Promise.allSettled(enabled.map(async s=>{await text(s.base_url,{signal,timeout:8000});return s;}));
  assertNotAborted(signal);
  const available=checks.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!available.length){const result={books,raw,rawCount:raw.length,checked:0,time,stale,notice,error:'下载源暂时均无法连接，稍后重试'};await setCache(`rank-${platform}`,result);onUpdate(result);return result;}
  for(let i=0;i<raw.length&&books.length<8;i+=2){
    assertNotAborted(signal);
    await Promise.all(raw.slice(i,i+2).map(async b=>{
      const match=await resolveBook(b,signal,available);if(match)books.push(match);
    }));
    books.sort((a,b)=>a.rank-b.rank);
    onUpdate({books:[...books],raw,rawCount:raw.length,checked:Math.min(i+2,raw.length),time,stale,notice});
  }
  const result={books,raw,rawCount:raw.length,checked:raw.length,time,stale,notice};
  await setCache(`rank-${platform}`,result);return result;
}
export async function prepareDownload(book,signal) {
  const s=book.sourceConfig;if(!s)return null;
  if(s.type==='chapter_scraper'){
    const url=s.catalog_url_suffix?`${book.detailUrl.replace(/\/$/,'')}/${s.catalog_url_suffix.replace(/^\/|\/$/g,'')}/`:book.detailUrl;
    const doc=documentOf(await text(url,{signal}));
    const seen=new Set(),chapters=[];
    let pattern;try{pattern=new RegExp(s.chapter_link_regex||'[.]html$');}catch{throw new Error('书源章节规则无效');}
    const directoryPath=new URL(book.detailUrl).pathname;
    const pages=all(doc,'a[href]').map(a=>webURL(a.getAttribute('href'),url)).filter(Boolean).map(link=>({url:link,match:new URL(link).pathname.match(/^(.*\/index_)(\d+)(\.html)$/)})).filter(p=>p.match&&p.match[1].startsWith(directoryPath)&&new URL(p.url).origin===new URL(url).origin);
    function append(document){
      const root=pages.length?(select(document,'.book_list2')||document):document;
      for(const a of all(root,s.chapter_list_selector||'ul.row a[href$=".html"]')){
        const raw=a.getAttribute('href')||'',chapterURL=webURL(raw,book.detailUrl);
        if(chapterURL&&pattern.test(raw)&&!seen.has(chapterURL)){seen.add(chapterURL);chapters.push({title:a.textContent.trim()||`第${chapters.length+1}章`,url:chapterURL});}
      }
    }
    append(doc);
    if(pages.length){
      const last=Math.max(...pages.map(p=>Number(p.match[2])));
      if(last>200)throw new Error('该源目录超过分页上限，未作为完整目录下载');
      const template=pages[0],base=new URL(template.url).origin+template.match[1];
      for(let page=2;page<=last;page++)append(documentOf(await text(base+page+template.match[3],{signal})));
    }
    if(chapters.length<(s.min_chapters||20))return null;
    await chapterText(chapters[0],s,signal);
    return {kind:'chapters',chapters};
  }
  const {book:parsed,doc}=parseSourceDetail(await text(book.detailUrl,{signal}),book.detailUrl,s,book);
  let url=parsed.downloadUrl;
  if(s.type==='7shutxt_search'){
    const m=book.detailUrl.match(/article-(\d+)-(\d+)\.html/);
    if(m){const page=new URL(`/download-${m[1]}-${m[2]}.html`,book.detailUrl).href;const d=documentOf(await text(page,{signal}));const a=all(d,'a[href]').find(a=>/DownSys.*pathid=0|pathid=0.*DownSys/.test(a.getAttribute('href'))||(/TXT/i.test(a.textContent)&&!/RAR/i.test(a.textContent)));url=webURL(a?.getAttribute('href')||'',page);}
  }
  if(s.type==='txt80_search'){
    const a=all(doc,'a[href]').find(a=>a.textContent.includes('进入小说下载地址'));
    if(a){const page=webURL(a.getAttribute('href'),book.detailUrl),d=documentOf(await text(page,{signal}));const a=all(d,'a[href]').find(a=>/\.txt(?:\?|$)/i.test(a.getAttribute('href')));url=webURL(a?.getAttribute('href')||'',page);}
  }
  if(!url&&s.type==='10000txt_search'){const a=all(doc,'.content a[href]').find(a=>/下载/.test(a.textContent));url=webURL(a?.getAttribute('href')||'',book.detailUrl);}
  // Share landing pages and paid links are not downloadable text files.
  if(!url||/(?:ctfile|z701)\.com|\/premium/i.test(url))return null;
  return {kind:'file',url};
}
async function chapterText(chapter,source,signal) {
  let url=chapter.url;const seen=new Set(),parts=[];
  while(url){
    assertNotAborted(signal);if(seen.has(url)||seen.size>=30)throw new Error('章节分页异常，请更换书源');seen.add(url);
    const d=documentOf(await text(url,{signal})),node=select(d,source.chapter_content_selector||'article.font_max');
    if(!node)throw new Error(`无法读取“${chapter.title}”，未保存不完整正文`);
    const lines=plain(node).split('\n').filter(line=>!/^第\(\d+\/\d+\)页/.test(line)&&!(source.skip_ad_keywords||['请收藏','最新网址','最新网址','加入书签']).some(k=>line.toLowerCase().includes(k.toLowerCase())));
    const content=lines.join('\n\n').trim();
    if(!content||/转码失败|章节不存在|内容已删除|源站不可用/.test(content)||(/请(?:先)?订阅|购买本章|付费阅读/.test(content)&&content.length<600))throw new Error(`“${chapter.title}”没有可用正文`);
    parts.push(content);
    const current=new URL(url),base=current.pathname.replace(/(?:_\d+)?\.html$/, '');
    const pageNumber=Number(current.pathname.match(/_(\d+)\.html$/)?.[1]||1);
    const pageCount=Number(d.body.textContent.match(/第\s*[（(]\s*\d+\s*\/\s*(\d+)\s*[）)]\s*页/)?.[1]||0);
    // Some configured sources label an intra-chapter page as “下一章”.
    // Exact next-page paths distinguish these from a different chapter.
    const next=all(d,'a[href]').find(a=>{const u=webURL(a.getAttribute('href'),url);if(!u)return false;const p=new URL(u);return p.origin===current.origin&&p.pathname===`${base}_${pageNumber+1}.html`&&/下一页|下页|下一章/.test(a.textContent)&&!seen.has(u);});
    if(pageCount>pageNumber&&!next)throw new Error(`“${chapter.title}”缺少第 ${pageNumber+1}/${pageCount} 页，未保存不完整正文`);
    url=next?webURL(next.getAttribute('href'),url):'';
  }
  return parts.join('\n\n');
}
export async function downloadBook(book,{signal,onProgress=()=>{}}={}) {
  const prepared=book.prepared||await prepareDownload(book,signal);
  if(!prepared)throw new Error('未找到可直接下载的正文，请更换书源');
  let content='';
  if(prepared.kind==='file'){
    onProgress({done:0,total:1,label:'正在下载正文'});
    const r=await request(prepared.url,{signal,timeout:60000});content=decodeText(r.bytes);
    if(/<(?:!doctype|html|head|body)[\s>]/i.test(content.slice(0,600)))throw new Error('下载链接返回了网页，未作为小说保存');
    if(content.trim().length<1000)throw new Error('正文文件过短，请更换书源');
    onProgress({done:1,total:1,label:'正文已下载'});
  }else{
    const parts=new Array(prepared.chapters.length);let done=0;
    // Two requests at a time keep long books usable without flooding the source.
    for(let i=0;i<prepared.chapters.length;i+=2){
      assertNotAborted(signal);
      await Promise.all(prepared.chapters.slice(i,i+2).map(async(ch,j)=>{
        let body;try{body=await chapterText(ch,book.sourceConfig,signal);}catch(error){if(error.name==='AbortError')throw error;throw new Error(`第 ${i+j+1}/${parts.length} 章“${ch.title}”读取失败：${error.message}`);}
        parts[i+j]=`${ch.title}\n\n${body}`;
        onProgress({done:++done,total:parts.length,label:ch.title});
      }));
      await new Promise(resolve=>setTimeout(resolve,180));
    }
    content=`《${book.title}》\n作者：${book.author}\n\n${parts.join('\n\n')}`;
  }
  assertNotAborted(signal);
  const cover=await coverData(book.cover,signal);
  return {text:content,book:{...book,cover:cover||'',remoteCover:book.cover,prepared:undefined,alternatives:undefined,sourceConfig:undefined,id:bookId(book)}};
}
