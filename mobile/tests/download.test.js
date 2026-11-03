import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
globalThis.DOMParser=DOMParser;
const {downloadBook}=await import('../src/catalog.js');
test('正文下载不会把 HTML 登录页当作小说',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response('<!doctype html><html><body>登录后继续</body></html>');
 try{await assert.rejects(downloadBook({id:'b',title:'测试',author:'甲',prepared:{kind:'file',url:'https://example.com/book.txt'}}),/返回了网页/);}finally{globalThis.fetch=previous;}
});
test('任意章节失败时整本拒绝完成，不返回缺章书籍',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(_,options)=>{
  const url=JSON.parse(options.body).url;
  return url.endsWith('2.html')?new Response('source unavailable',{status:503}):new Response('<html><body><article>这是完整正文。</article></body></html>');
 };
 const b={id:'b',title:'测试',author:'甲',sourceConfig:{chapter_content_selector:'article'},prepared:{kind:'chapters',chapters:[{title:'第一章',url:'https://example.com/1.html'},{title:'第二章',url:'https://example.com/2.html'}]}};
 try{await assert.rejects(downloadBook(b),/503/);}finally{globalThis.fetch=previous;}
});
test('取消后不继续获取正文',async()=>{
 const controller=new AbortController();controller.abort();let called=false;const previous=globalThis.fetch;
 globalThis.fetch=async()=>{called=true;return new Response('正文');};
 try{await assert.rejects(downloadBook({id:'b',title:'测试',prepared:{kind:'file',url:'https://example.com/book.txt'}},{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(called,false);}finally{globalThis.fetch=previous;}
});
test('章节下载遇到临时502会重试，成功后才继续',async()=>{
 const previous=globalThis.fetch;let attempts=0;
 globalThis.fetch=async()=>++attempts===1?new Response('temporary',{status:502}):new Response('这是完整正文。'.repeat(300));
 try{
  const result=await downloadBook({id:'retry',title:'测试',author:'甲',prepared:{kind:'file',url:'https://example.com/book.txt'}});
  assert.equal(attempts,2);assert.ok(result.text.length>1000);
 }finally{globalThis.fetch=previous;}
});
test('源站转码失败提示不能作为章节正文保存',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response('<html><body><article>转码失败！请切换源站阅读。</article></body></html>');
 try{
  await assert.rejects(downloadBook({id:'bad-content',title:'测试',sourceConfig:{chapter_content_selector:'article'},prepared:{kind:'chapters',chapters:[{title:'第一章',url:'https://example.com/1.html'}]}}),/没有可用正文/);
 }finally{globalThis.fetch=previous;}
});

test('下一章标签的同章三页必须全部合并，并且不读取不同章节',async()=>{
 const previous=globalThis.fetch,visited=[];
 globalThis.fetch=async(_,options)=>{
  const url=JSON.parse(options.body).url;visited.push(url);const n=Number(url.match(/_(\d+)\.html/)?.[1]||1);
  return new Response(`<html><body><article>第(${n}/3)页<br>第${n}页正文</article><a href="${n<3?`/10_${n+1}.html`:'/11.html'}">下一章</a></body></html>`);
 };
 try{
  const r=await downloadBook({id:'pages',title:'测试',sourceConfig:{chapter_content_selector:'article'},prepared:{kind:'chapters',chapters:[{title:'第一章',url:'https://example.com/10.html'}]}});
  for(const n of [1,2,3])assert.ok(r.text.includes(`第${n}页正文`));assert.equal(visited.length,3);
 }finally{globalThis.fetch=previous;}
});

test('页码提示还有正文但下一页链接丢失时拒绝完成',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response('<html><body><article>第(1/3)页<br>部分正文</article></body></html>');
 try{await assert.rejects(downloadBook({id:'missing-page',title:'测试',sourceConfig:{chapter_content_selector:'article'},prepared:{kind:'chapters',chapters:[{title:'第一章',url:'https://example.com/10.html'}]}}),/缺少第 2\/3 页/);}finally{globalThis.fetch=previous;}
});
