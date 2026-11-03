import fs from 'node:fs';
import {DOMParser} from 'linkedom';
import 'fake-indexeddb/auto';
import {proxyRequest} from '../proxy.js';
import {DiscoveryFeed} from '../src/discovery.js';
globalThis.DOMParser=DOMParser;
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
process.env.NODE_USE_ENV_PROXY='0';
const direct=fetch.bind(globalThis);globalThis.fetch=(url,options)=>url==='/api/fetch'?proxyRequest(JSON.parse(options.body),direct):direct(url,options);
const feed=new DiscoveryFeed({channel:'male',genre:'fantasy'}),books=[],pages=[];
for(let i=0;i<3;i++){const r=await feed.next();books.push(...r.books);pages.push(r.page);}
const report={pages,books:books.length,unique:new Set(books.map(b=>b.id)).size,covers:books.filter(b=>b.cover).length,proxyEnvironment:false};
fs.mkdirSync('.reports',{recursive:true});fs.writeFileSync('.reports/discovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(report.books<=24||report.unique!==report.books||new Set(pages).size!==3)throw Error('Continuous discovery did not append distinct real pages');
