import fs from 'node:fs';
import {DOMParser} from 'linkedom';
import 'fake-indexeddb/auto';
import {proxyRequest} from '../proxy.js';
import {DiscoveryFeed} from '../src/discovery.js';
import {verifiedBatch} from '../src/verified-feed.js';
globalThis.DOMParser=DOMParser;
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
process.env.NODE_USE_ENV_PROXY='0';
const direct=globalThis.fetch.bind(globalThis);
globalThis.fetch=(url,options)=>url==='/api/fetch'?proxyRequest(JSON.parse(options.body),direct):direct(url,options);
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
try{
 const feed=new DiscoveryFeed({channel:'male',genre:'fantasy'});
 const candidates=(await feed.next({signal:controller.signal})).books.slice(0,4);
 const result=await verifiedBatch(candidates,{signal:controller.signal,onBook:b=>console.log(JSON.stringify({title:b.title,source:b.source,...b.verification})),onProgress:p=>console.log(JSON.stringify(p))});
 fs.mkdirSync('.reports',{recursive:true});fs.writeFileSync('.reports/verified-feed.json',JSON.stringify({time:new Date().toISOString(),proxyEnvironment:false,checked:result.checked,rejected:result.rejected,books:result.books.map(b=>({title:b.title,author:b.author,source:b.source,verification:b.verification}))},null,2));
 if(!result.books.length)process.exitCode=1;
}finally{clearTimeout(timer);}
