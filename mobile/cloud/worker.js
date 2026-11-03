import {proxyRequest} from '../proxy.js';
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/fetch'){
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return new Response('Forbidden',{status:403});
    if(Number(request.headers.get('content-length')||0)>16384)return new Response('Payload too large',{status:413});
    try{return await proxyRequest(await request.json());}catch{return new Response('书源连接失败，请稍后重试',{status:502});}
  }
  return env.ASSETS.fetch(request);
}};
