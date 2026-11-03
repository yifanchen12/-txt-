const DB_NAME = 'shiye-library';
let opening;
export function database() {
  if (!opening) opening = new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME,1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('books',{keyPath:'id'});
      db.createObjectStore('texts',{keyPath:'id'});
      db.createObjectStore('settings');
      db.createObjectStore('cache');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}
async function read(store,key) {
  const db = await database();
  return new Promise((resolve,reject) => {const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
async function write(store,key,value) {
  const db = await database();
  return new Promise((resolve,reject) => {const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export const getSetting = key => read('settings',key);
export const setSetting = (key,value) => write('settings',key,value);
export const getCache = key => read('cache',key);
export const setCache = (key,value) => write('cache',key,value);
export async function listBooks() {
  const db=await database();
  return new Promise((resolve,reject)=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>(b.lastRead||b.added)-(a.lastRead||a.added)));r.onerror=()=>reject(r.error);});
}
export const getBook = id => read('books',id);
export async function getText(id) {return (await read('texts',id))?.text;}
export async function saveBook(book,text) {
  const db=await database();
  const old=await getBook(book.id);
  const value={...old,...book,added:old?.added||Date.now(),offset:old?.offset||0,bytes:new Blob([text]).size};
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['books','texts'],'readwrite');
    tx.objectStore('books').put(value);tx.objectStore('texts').put({id:book.id,text});
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function saveProgress(id,offset) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('books','readwrite'),store=tx.objectStore('books'),r=store.get(id);
    r.onsuccess=()=>{if(r.result)store.put({...r.result,offset,lastRead:Date.now()});};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
export async function deleteBook(id) {
  const db=await database();
  return new Promise((resolve,reject)=>{const tx=db.transaction(['books','texts'],'readwrite');tx.objectStore('books').delete(id);tx.objectStore('texts').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
