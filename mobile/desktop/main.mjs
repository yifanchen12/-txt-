import {app,BrowserWindow,ipcMain,protocol,shell} from 'electron';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {proxyRequest,proxyErrorMessage} from '../proxy.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='shiye://library';
protocol.registerSchemesAsPrivileged([{scheme:'shiye',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('拾页');
if(process.platform==='win32')app.setAppUserModelId('com.shiye.reader');
// Keep the library origin and data directory stable across portable upgrades.
const libraryPath=path.join(app.getPath('appData'),'ShiyeReader');
await mkdir(libraryPath,{recursive:true});
app.setPath('userData',libraryPath);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const external=url=>{try{const u=new URL(url);if(['https:','http:'].includes(u.protocol))shell.openExternal(u.href);}catch{}};
let window;
app.whenReady().then(()=>{
protocol.handle('shiye',async request=>{
  const url=new URL(request.url);
  if(url.host!=='library')return new Response('Not found',{status:404});
  const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  const filename=path.resolve(root,'dist','.'+relative),dist=path.join(root,'dist')+path.sep;
  if(!filename.startsWith(dist))return new Response('Forbidden',{status:403});
  try{return new Response(await readFile(filename),{headers:{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"}});}catch{return new Response('Not found',{status:404});}
});
ipcMain.handle('shiye:request',async(event,payload)=>{
  if(!event.senderFrame?.url.startsWith(origin+'/'))throw new Error('请求来源无效');
  try{
    const response=await proxyRequest(payload);
    return {status:response.status,headers:Object.fromEntries(response.headers),data:Buffer.from(await response.arrayBuffer()).toString('base64')};
  }catch(error){return {status:502,headers:{'x-shiye-error':'network'},data:Buffer.from(proxyErrorMessage(error)).toString('base64')};}
});
function open(){
  window=new BrowserWindow({width:1380,height:900,minWidth:760,minHeight:600,title:'拾页',icon:path.join(root,'dist','app-icon.png'),backgroundColor:'#f4f6f5',autoHideMenuBar:true,show:false,webPreferences:{preload:path.join(root,'desktop','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(({url})=>{external(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')){event.preventDefault();external(url);}});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window.show());
  window.loadURL(origin+'/');
}
open();
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)open();});
app.on('window-all-closed',()=>app.quit());

// Packaging check: the real window must load; network uses the same allowlisted
// Node HTTP implementation as desktop requests, without an external service.
if(process.argv.includes('--smoke-test')){
  const result={pageLoaded:false,directHTTP:false};
  window.webContents.once('did-finish-load',async()=>{
    result.pageLoaded=true;
    try{const r=await proxyRequest({url:'https://www.fsshu.com/search.php?q=%E8%AF%A1%E7%A7%98%E4%B9%8B%E4%B8%BB'});result.directHTTP=r.ok&&(await r.text()).includes('诡秘之主');}catch{}
    await writeFile(path.join(app.getPath('userData'),'verification.json'),JSON.stringify(result));
    app.exit(result.pageLoaded&&result.directHTTP?0:1);
  });
}
}).catch(async error=>{
  await writeFile(path.join(libraryPath,'startup-error.log'),error.message);
  app.exit(1);
});
