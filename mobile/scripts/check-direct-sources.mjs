import fs from 'node:fs';
import {DOMParser} from 'linkedom';
import 'fake-indexeddb/auto';
import {proxyRequest} from '../proxy.js';
import {defaultSources,searchSource,prepareDownload,documentOf} from '../src/catalog.js';
import {sameBook} from '../src/core.js';
import {text} from '../src/network.js';

globalThis.DOMParser=DOMParser;
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
process.env.NODE_USE_ENV_PROXY='0';
const directFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=(url,options)=>url==='/api/fetch'?proxyRequest(JSON.parse(options.body),directFetch):directFetch(url,options);
const query=process.argv[2]||'诡秘之主';
const report={time:new Date().toISOString(),proxyEnvironment:false,query,sources:[],verifiedSources:0};
const list=defaultSources.download_sources.filter(s=>s.base_url);
for(let i=0;i<list.length;i+=3){
 await Promise.all(list.slice(i,i+3).map(async source=>{
  const result={source:source.name,host:new URL(source.base_url).hostname,matches:0,chapterSamples:0};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{
   const books=await searchSource(source,query,controller.signal,{limit:3});
   const matches=books.filter(b=>sameBook({title:query},b));result.matches=matches.length;
   if(matches.length){
    result.title=matches[0].title;result.author=matches[0].author;
    const prepared=await prepareDownload(matches[0],controller.signal);
    result.format=prepared?.kind||'unresolved';
    if(prepared?.kind==='chapters'){
     result.catalogChapters=prepared.chapters.length;
     const samples=[prepared.chapters[0],prepared.chapters.at(-1)];
     for(const sample of samples){
      const doc=documentOf(await text(sample.url,{signal:controller.signal}));
      const node=doc.querySelector(source.chapter_content_selector||'article.font_max');
      if(node&&node.textContent.trim().length>200)result.chapterSamples++;
     }
     if(result.chapterSamples===2)report.verifiedSources++;
    }
   }
  }catch(error){result.error=error.name==='AbortError'?'检索超过60秒':error.message;}
  finally{clearTimeout(timer);report.sources.push(result);console.log(JSON.stringify(result));}
 }));
}
fs.mkdirSync('.reports',{recursive:true});
fs.writeFileSync('.reports/direct-sources.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({verifiedSources:report.verifiedSources,proxyEnvironment:false}));
if(!report.verifiedSources)process.exitCode=1;
