import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
import 'fake-indexeddb/auto';
import {verifyDownload,downloadBook} from '../src/catalog.js';
import {verifiedBatch} from '../src/verified-feed.js';
import {loading} from '../src/loading.js';
globalThis.DOMParser=DOMParser;
const source={type:'chapter_scraper',min_chapters:3,chapter_list_selector:'a',chapter_link_regex:'[.]html$',chapter_content_selector:'article'};
const book={title:'核验',author:'甲',detailUrl:'https://example.com/book/',sourceConfig:source};
const directory='<a href="1.html">第一章</a><a href="2.html">第二章</a><a href="3.html">第三章</a>';
test('推荐核验实取首中末正文，末章付费或错误时不通过',async()=>{
 const original=globalThis.fetch;const calls=[];let blocked=false;
 globalThis.fetch=async(_,options)=>{const url=JSON.parse(options.body).url;calls.push(url);return new Response(url.endsWith('/book/')?directory:`<article>${blocked&&url.endsWith('3.html')?'购买本章':'真实正文。'.repeat(50)}</article>`);};
 try{
   const result=await verifyDownload(book);assert.equal(result.verification.samples,3);assert.equal(result.verification.chapters,3);assert.ok(calls.some(u=>u.endsWith('2.html')));assert.ok(calls.some(u=>u.endsWith('3.html')));
   blocked=true;await assert.rejects(verifyDownload(book),/没有可用正文/);
 }finally{globalThis.fetch=original;}
});
test('TXT推荐实际取文件，拒绝网页；下载复查不会复用旧链接',async()=>{
 const original=globalThis.fetch;const calls=[];let html=false;
 globalThis.fetch=async(_,options)=>{const url=JSON.parse(options.body).url;calls.push(url);return new Response(url.endsWith('/detail')?'<a href="new.txt">TXT下载</a>':html?'<html>请登录</html>':'正文内容。'.repeat(300));};
 const file={...book,detailUrl:'https://example.com/detail',sourceConfig:{type:'generic'},prepared:{kind:'file',url:'https://example.com/stale.txt'}};
 try{
   assert.equal((await verifyDownload(file)).verification.kind,'file');assert.ok(calls.includes('https://example.com/new.txt'));html=true;await assert.rejects(verifyDownload(file),/返回了网页/);
   html=false;calls.length=0;await downloadBook(file,{recheck:true});assert.ok(calls.includes(file.detailUrl));assert.ok(!calls.includes('https://example.com/stale.txt'));
 }finally{globalThis.fetch=original;}
});
test('只把检验通过的书交给推荐区，取消后不再追加',async()=>{
 const shown=[],progress=[];const controller=new AbortController();
 const result=await verifiedBatch([{title:'好书'},{title:'坏书'},{title:'未核验'}],{verify:async b=>{if(b.title==='坏书')throw new Error('不可下载');return b.title==='未核验'?b:{...b,verification:{checkedAt:1}};},onBook:b=>shown.push(b),onProgress:p=>progress.push(p)});
 assert.deepEqual(shown.map(b=>b.title),['好书']);assert.equal(result.rejected,2);assert.equal(progress.at(-1).checked,3);
 await assert.rejects(verifiedBatch([{title:'取消'}],{signal:controller.signal,verify:async b=>{controller.abort();return {...b,verification:{}};},onBook:()=>assert.fail('取消后不能展示')}),e=>e.name==='AbortError');
});
test('共享加载组件转义文案，只有真实总量才显示进度',()=>{
 const d=new DOMParser().parseFromString(loading({label:'<script>bad</script>',done:9,total:3}),'text/html');assert.equal(d.querySelector('script'),null);assert.equal(d.querySelector('progress').getAttribute('value'),'3');assert.equal(d.querySelector('[role=status]')!==null,true);
 assert.ok(!loading({label:'查源'}).includes('<progress'));assert.ok(loading({compact:true}).includes('is-compact'));
});
