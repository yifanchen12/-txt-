import test from 'node:test';
import assert from 'node:assert/strict';
import {request,text} from '../src/network.js';

test('Windows 请求使用本机桥，正文按响应编码读取，不调用网页服务',async()=>{
 const previousFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{throw new Error('不应调用网页服务器');};
 globalThis.shiyeDesktop={request:async payload=>{calls++;assert.equal(payload.url,'https://www.fsshu.com/test');return {status:200,headers:{'content-type':'text/plain; charset=utf-8'},data:Buffer.from('本机正文').toString('base64')};}};
 try{assert.equal(await text('https://www.fsshu.com/test'),'本机正文');assert.equal(calls,1);}finally{delete globalThis.shiyeDesktop;globalThis.fetch=previousFetch;}
});
test('Windows 返回的网络错误保留可读原因，取消后不发请求',async()=>{
 globalThis.shiyeDesktop={request:async()=>({status:502,headers:{'x-shiye-error':'network'},data:Buffer.from('连接书源超时，请稍后重试').toString('base64')})};
 try{
  await assert.rejects(request('https://www.fsshu.com/test',{retries:0}),/连接书源超时/);
  const controller=new AbortController();controller.abort();globalThis.shiyeDesktop.request=()=>{throw new Error('不应请求');};
  await assert.rejects(request('https://www.fsshu.com/test',{signal:controller.signal}),e=>e.name==='AbortError');
 }finally{delete globalThis.shiyeDesktop;}
});
