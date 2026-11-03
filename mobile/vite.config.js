import {defineConfig} from 'vite';
import {proxyRequest,proxyErrorMessage} from './proxy.js';
import {createHash} from 'node:crypto';
function localProxy(){return {name:'source-proxy',configureServer(server){server.middlewares.use('/api/fetch',async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){res.writeHead(413);res.end();return;}}
    const response=await proxyRequest(JSON.parse(body));res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();
  }catch(error){if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain;charset=utf-8','X-Shiye-Error':'network'});res.end(proxyErrorMessage(error));}
});}};}
function offline(){return {name:'offline-reader',generateBundle(_,bundle){
  const files=Object.keys(bundle).filter(f=>!f.endsWith('.map'));
  const hash=createHash('sha256').update(files.join('|')).digest('hex').slice(0,12);
  this.emitFile({type:'asset',fileName:'sw.js',source:`const CACHE='shiye-${hash}';const FILES=${JSON.stringify(['./','./icon.svg',...files.map(f=>'./'+f)])};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('shiye-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin||new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return response;})));});`});
}};}
export default defineConfig({base:'./',plugins:[localProxy(),offline()],build:{target:'es2022',chunkSizeWarningLimit:600},server:{port:5178,strictPort:true}});
