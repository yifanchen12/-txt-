import {Capacitor,CapacitorHttp} from '@capacitor/core';
import {decodeText,webURL,assertNotAborted} from './core.js';
export const native = Capacitor.isNativePlatform();
export async function request(url,{method='GET',body,signal,timeout=18000}={}) {
  assertNotAborted(signal);
  if (!webURL(url)) throw new Error('书源地址格式不正确');
  let bytes,headers,status;
  if (native) {
    const r=await CapacitorHttp.request({url,method,data:body,headers:{'User-Agent':'Mozilla/5.0',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},responseType:'arraybuffer',connectTimeout:timeout,readTimeout:timeout});
    status=r.status;headers=r.headers||{};
    if(typeof r.data!=='string')throw new Error('书源返回了不支持的数据');
    const raw=atob(r.data);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  } else {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    try {
      const r=await fetch('/api/fetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,method,body}),signal:controller.signal});
      status=r.status;headers=Object.fromEntries(r.headers.entries());bytes=new Uint8Array(await r.arrayBuffer());
    } catch(e) {
      if(signal?.aborted)throw new DOMException('操作已取消','AbortError');
      if(e.name==='AbortError')throw new Error('书源连接超时，请稍后重试');
      throw new Error('当前网络无法连接书源，请检查网络后重试');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  assertNotAborted(signal);
  if(status<200||status>=300)throw new Error(status===403?'书源暂时拒绝访问':`书源响应异常（${status}）`);
  return {bytes,headers};
}
export async function text(url,options={}) {
  const r=await request(url,options);
  const type=r.headers['content-type']||r.headers['Content-Type']||'';
  const hint=type.match(/charset=([\w-]+)/i)?.[1]||'';
  return decodeText(r.bytes,hint);
}
export async function coverData(url,signal) {
  if(!url)return '';
  try {
    const {bytes,headers}=await request(url,{signal,timeout:10000});
    if(bytes.length>3*1024*1024)return '';
    const mime=headers['content-type']||headers['Content-Type']||'image/jpeg';
    if(!/^image\/(jpeg|png|webp|gif|avif)(?:;|$)/i.test(mime))return '';
    return await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=reject;f.readAsDataURL(new Blob([bytes],{type:mime}));});
  } catch {return '';}
}
