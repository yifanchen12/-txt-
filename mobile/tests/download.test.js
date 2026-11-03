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
