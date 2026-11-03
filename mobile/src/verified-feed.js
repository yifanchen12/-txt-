import {verifyDownload} from './catalog.js';
import {assertNotAborted} from './core.js';

export async function verifiedBatch(candidates,{signal,verify=verifyDownload,onBook=()=>{},onProgress=()=>{}}={}) {
  let checked=0,rejected=0;const books=[];
  const readable=candidates.filter(b=>!/[\ue000-\uf8ff]/u.test(`${b.title||''}${b.author||''}`));
  for(let i=0;i<readable.length;i+=2){
    assertNotAborted(signal);
    await Promise.all(readable.slice(i,i+2).map(async candidate=>{
      try{
        const book=await verify(candidate,{signal});assertNotAborted(signal);
        if(!book?.verification)throw new Error('正文未验证');
        books.push(book);onBook(book);
      }catch(error){assertNotAborted(signal);if(error.name==='AbortError')throw error;rejected++;}
      onProgress({checked:++checked,total:readable.length,rejected});
    }));
  }
  return {books,checked,rejected};
}
