import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {saveBook,listBooks,getText,saveProgress,getBook,deleteBook,setSetting,getSetting} from '../src/storage.js';
test('正文与书目同时保存，恢复阅读偏移，删除时清理正文',async()=>{
 await saveBook({id:'a',title:'离线测试',characters:5},'这是正文。');
 assert.equal(await getText('a'),'这是正文。');assert.equal((await listBooks()).length,1);
 await saveProgress('a',3);assert.equal((await getBook('a')).offset,3);
 await saveBook({id:'a',title:'离线测试',characters:6},'这是新正文。');assert.equal((await getBook('a')).offset,3);
 await deleteBook('a');assert.equal(await getText('a'),undefined);assert.equal((await listBooks()).length,0);
});
test('阅读设置可持久恢复',async()=>{await setSetting('reader',{fontSize:25,theme:'green'});assert.deepEqual(await getSetting('reader'),{fontSize:25,theme:'green'});});
