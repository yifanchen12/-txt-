import defaults from './src/default-sources.json' with {type:'json'};
const configured=[...defaults.ranking_sources,...defaults.download_sources].flatMap(s=>[s.base_url,s.ranking_url,s.search_url,s.search_url_template,...(s.urls||[])]).filter(Boolean).map(s=>{try{return new URL(s).hostname;}catch{return '';}});
const exact=new Set([...configured,'m.qidian.com','www.qidian.com','m.qdmm.com','fanqienovel.com','www.jjwxc.net','www.jjwxc.com','bookcover.yuewen.com']);
const images=['fqnovelpic.com','byteimg.com','jjwxc.net','jjwxc.com','yuewen.com'];
export function allowedURL(raw){try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return false;return exact.has(u.hostname)||images.some(host=>u.hostname.endsWith('.'+host));}catch{return false;}}
export async function proxyRequest(payload,fetcher=fetch){
  if(!payload||!allowedURL(payload.url)||!['GET','POST'].includes(payload.method||'GET'))return new Response('不支持的书源请求',{status:400});
  if(payload.body&&typeof payload.body!=='string')return new Response('请求格式不正确',{status:400});
  let url=payload.url,method=payload.method||'GET',body=payload.body;
  for(let i=0;i<8;i++){
    const response=await fetcher(url,{method,body:method==='POST'?body:undefined,headers:{'User-Agent':'Mozilla/5.0 (compatible; Shiye/1.0)','Accept':'text/html,application/json,image/*,*/*',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},redirect:'manual',signal:AbortSignal.timeout(18000)});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');if(!location)return new Response('书源重定向异常',{status:502});
      const next=new URL(location,url).href;if(!allowedURL(next))return new Response('书源跳转到未配置的地址',{status:403});
      if(response.status===303||([301,302].includes(response.status)&&method==='POST')){method='GET';body=undefined;}
      url=next;continue;
    }
    const length=Number(response.headers.get('content-length')||0);
    if(length>80*1024*1024)return new Response('文件超过下载大小限制',{status:413});
    const headers=new Headers({'Content-Type':response.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    return new Response(response.body,{status:response.status,headers});
  }
  return new Response('书源重定向次数过多',{status:502});
}
