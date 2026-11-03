import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedURL,proxyRequest} from '../proxy.js';
test('网页请求只允许配置内的源和图片站',()=>{
 assert.equal(allowedURL('http://127.0.0.1/private'),false);assert.equal(allowedURL('file:///etc/passwd'),false);
 assert.equal(allowedURL('https://m.qidian.com.evil.example/book'),false);assert.equal(allowedURL('https://user:password@m.qidian.com/'),false);
 assert.equal(allowedURL('https://m.qidian.com/rank/hotsales/'),true);assert.equal(allowedURL('https://s5-static.jjwxc.net/cover.jpg'),true);
});
test('禁止书源重定向到本地或未配置域名',async()=>{
 const r=await proxyRequest({url:'https://m.qidian.com/',method:'GET'},async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}}));assert.equal(r.status,403);
});
test('代理只保留正文响应头，不转发 Cookie',async()=>{
 const r=await proxyRequest({url:'https://m.qidian.com/',method:'GET'},async()=>new Response('正文',{headers:{'set-cookie':'fixture=private','content-type':'text/plain;charset=utf-8'}}));assert.equal(await r.text(),'正文');assert.equal(r.headers.get('set-cookie'),null);
});
