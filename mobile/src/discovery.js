import {text} from './network.js';
import {documentOf,sources} from './catalog.js';
import {bookId,webURL,completed} from './core.js';

export const CATEGORIES={
  all:[{id:'all',label:'全部题材'}],
  male:[{id:'all',label:'全部'},{id:'fantasy',label:'玄幻',pattern:/玄幻|奇幻/,source:1},{id:'wuxia',label:'仙侠武侠',pattern:/仙侠|武侠|修真/,source:2},{id:'urban',label:'都市',pattern:/都市|现实/,source:3},{id:'history',label:'历史',pattern:/历史|军事/,source:4},{id:'scifi',label:'科幻',pattern:/科幻|末世/,source:6},{id:'game',label:'游戏',pattern:/游戏|网游|竞技/,source:5},{id:'mystery',label:'悬疑',pattern:/悬疑|灵异|恐怖/,source:8}],
  female:[{id:'all',label:'全部'},{id:'romance',label:'言情',pattern:/言情/,source:7},{id:'modern',label:'现代言情',pattern:/现代言情|近代现代|现言|豪门/,source:7},{id:'ancient',label:'古代言情',pattern:/古代言情|古色古香|架空历史|古言/,source:7},{id:'romance-fantasy',label:'幻想言情',pattern:/幻想言情|仙侠奇缘|言情.*(?:奇幻|幻想|仙侠)/,source:7},{id:'youth',label:'青春校园',pattern:/青春|校园/,source:7},{id:'danmei',label:'纯爱',pattern:/纯爱|耽美/,source:7}]
};
export function matchesCategory(book,{channel='all',genre='all'}={}){
  const tag=book.genre||'';
  const female=/言情|纯爱|耽美|百合|女频|女尊|青春|校园/.test(tag);
  const male=/玄幻|奇幻|武侠|仙侠|修真|都市|现实|历史|军事|科幻|末世|游戏|网游|竞技|悬疑|灵异|恐怖/.test(tag)&&!female;
  if(channel==='female'&&!female||channel==='male'&&!male)return false;
  if(['modern','ancient','romance-fantasy'].includes(genre)&&!/言情|现言|古言|仙侠奇缘/.test(tag))return false;
  return genre==='all'||Boolean(CATEGORIES[channel]?.find(c=>c.id===genre)?.pattern?.test(tag));
}
export function parseDiscoveryPage(html,url,source){
  const d=documentOf(html),books=[],seen=new Set();
  const current=new URL(url),m=current.pathname.match(/^\/full\/(\d+)_(\d+)\.html$/);
  const pageGenre={1:'玄幻',2:'武侠',3:'都市',4:'历史',5:'网游',6:'科幻',7:'言情',8:'其他'}[Number(m?.[1])]||'';
  for(const card of d.querySelectorAll('dl')){
    const link=card.querySelector('h3 a[href]');if(!link)continue;
    const detailUrl=webURL(link.getAttribute('href'),url);
    if(!detailUrl||new URL(detailUrl).origin!==new URL(url).origin||!/^\/book\/\d+\/\d+\/$/.test(new URL(detailUrl).pathname))continue;
    const label=link.textContent.trim(),genre=label.match(/^\[([^\]]+)\]/)?.[1]||pageGenre;
    const title=label.replace(/^\[[^\]]+\]/,'').trim();
    const lines=[...card.querySelectorAll('dd')].map(n=>n.textContent.trim());
    const author=lines.find(t=>/^作者[：:]/.test(t))?.replace(/^作者\s*[：:]\s*/,'').trim()||'';
    const status=lines.find(t=>/^状态[：:]/.test(t))?.replace(/^状态\s*[：:]\s*/,'').trim()||'';
    if(!title||!author||!completed({status}))continue;
    const book={title,author,genre,status,detailUrl,cover:webURL(card.querySelector('img')?.getAttribute('src')||'',url),source:source.name,sourceType:source.type,sourceConfig:source};
    book.id=bookId(book);if(!seen.has(book.id)){books.push(book);seen.add(book.id);}
  }
  const next=[...d.querySelectorAll('a[href]')].map(a=>webURL(a.getAttribute('href'),url)).filter(Boolean).filter(link=>{
    const u=new URL(link),p=u.pathname.match(/^\/full\/(\d+)_(\d+)\.html$/);
    return m&&p&&u.origin===current.origin&&p[1]===m[1]&&Number(p[2])>Number(m[2]);
  }).sort((a,b)=>Number(new URL(a).pathname.match(/_(\d+)\.html$/)[1])-Number(new URL(b).pathname.match(/_(\d+)\.html$/)[1]))[0]||'';
  return {books,next};
}
export class DiscoveryFeed{
  constructor(filter={}){
    this.filter={channel:'all',genre:'all',...filter};this.seen=new Set();this.visited=new Set();this.queue=null;this.source=null;
  }
  async init(){
    const enabled=await sources();this.source=enabled.find(s=>s.name==='qb5200_chapter_scraper');
    if(!this.source)throw new Error('请在书源设置中启用 qb5200，才能继续浏览分类书目');
    const selected=CATEGORIES[this.filter.channel]?.find(c=>c.id===this.filter.genre);
    const ids=selected?.source?[selected.source]:this.filter.channel==='female'?[7]:this.filter.channel==='male'?[1,2,3,4,6,5,8]:[1,7,3,2,6,4,5,8];
    this.queue=ids.map(id=>new URL(`/full/${id}_1.html`,this.source.base_url).href);
  }
  async next({signal,exclude=[]}={}){
    if(!this.queue)await this.init();
    if(!(await sources()).some(s=>s.name===this.source.name))throw new Error('分类书源已关闭，启用后可继续浏览');
    exclude.forEach(id=>this.seen.add(id));
    while(this.queue.length&&this.visited.has(this.queue[0]))this.queue.shift();
    const url=this.queue[0];if(!url)return {books:[],hasMore:false};
    const parsed=parseDiscoveryPage(await text(url,{signal}),url,this.source);
    if(!parsed.books.length)throw new Error('这页书目暂时无法读取，点击重试');
    // Advance only after a valid response, so retry never skips a failed page.
    this.queue.shift();this.visited.add(url);
    if(parsed.next&&!this.visited.has(parsed.next)&&!this.queue.includes(parsed.next))this.queue.push(parsed.next);
    const books=parsed.books.filter(book=>{
      if(this.seen.has(book.id))return false;this.seen.add(book.id);return matchesCategory(book,this.filter);
    });
    return {books,hasMore:this.queue.length>0,page:url};
  }
}
