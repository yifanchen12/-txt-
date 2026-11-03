import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
import 'fake-indexeddb/auto';
import {DiscoveryFeed,parseDiscoveryPage,matchesCategory} from '../src/discovery.js';
import {readingMode,pageAtOffset} from '../src/reader-effects.js';
globalThis.DOMParser=DOMParser;
const source={name:'qb5200_chapter_scraper',type:'chapter_scraper',base_url:'https://www.qb5200.org/'};
const card=(id,title,genre='玄幻',author='甲')=>`<dl><dt><img src="/images/${id}.jpg"></dt><dd><h3><a href="/book/1/${id}/">[${genre}]${title}</a></h3></dd><dd class="book_other">作者：${author}</dd><dd class="book_other">状态：完本</dd></dl>`;
test('真实书目结构提取封面和作者，只跟随同分类后续分页',()=>{
 const r=parseDiscoveryPage(`<html><body>${card(1,'第一本')}<a href="/full/1_1.html">1</a><a href="/full/1_3.html">3</a><a href="/full/1_2.html">2</a><a href="/full/7_2.html">女频</a><a href="https://evil.example/full/1_2.html">广告</a></body></html>`,'https://www.qb5200.org/full/1_1.html',source);
 assert.equal(r.books[0].title,'第一本');assert.equal(r.books[0].author,'甲');assert.equal(r.books[0].cover,'https://www.qb5200.org/images/1.jpg');assert.equal(r.next,'https://www.qb5200.org/full/1_2.html');
 const noLabel=parseDiscoveryPage(`<html><body>${card(1,'无前缀的书').replace('[玄幻]','')}</body></html>`,'https://www.qb5200.org/full/7_1.html',source);assert.equal(noLabel.books[0].genre,'言情');
});
test('下一批追加并去重，失败重试不跳过原页',async()=>{
 const previous=globalThis.fetch;let fail=true;const urls=[];
 globalThis.fetch=async(_,options)=>{const url=JSON.parse(options.body).url;urls.push(url);if(url.endsWith('1_2.html')&&fail)return new Response('failed',{status:403});return new Response(`<html><body>${url.endsWith('1_1.html')?card(1,'第一本')+`<a href="/full/1_2.html">2</a>`:card(1,'第一本')+card(2,'第二本')}</body></html>`);};
 try{const feed=new DiscoveryFeed({channel:'male',genre:'fantasy'});assert.equal((await feed.next()).books.length,1);await assert.rejects(feed.next(),/拒绝/);fail=false;const r=await feed.next();assert.deepEqual(r.books.map(b=>b.title),['第二本']);assert.equal(r.hasMore,false);assert.equal(urls.at(-1),'https://www.qb5200.org/full/1_2.html');}finally{globalThis.fetch=previous;}
});
test('男女频和细分类只依据明确题材，不按标题猜现代古代',()=>{
 assert.equal(matchesCategory({title:'穿越古代',genre:'言情'},{channel:'female',genre:'modern'}),false);
 assert.equal(matchesCategory({genre:'原创-言情-近代现代-爱情'},{channel:'female',genre:'modern'}),true);
 assert.equal(matchesCategory({genre:'原创-言情-架空历史-爱情'},{channel:'male',genre:'history'}),false);
 assert.equal(matchesCategory({genre:'仙侠'},{channel:'male',genre:'wuxia'}),true);
});
test('旧直接翻页设置迁移为横滑，换排版按同一字符位置定位',()=>{
 assert.equal(readingMode('instant'),'slide');assert.equal(readingMode('scroll'),'scroll');assert.equal(readingMode(undefined),'curl');
 const offset=620;assert.equal(pageAtOffset([{start:0},{start:400},{start:800}],offset),1);assert.equal(pageAtOffset([{start:0},{start:250},{start:500},{start:750}],offset),2);assert.equal(pageAtOffset([{start:0}],0),0);
});
