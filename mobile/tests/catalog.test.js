import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
globalThis.DOMParser=DOMParser;
const {parseOfficial,parseSourceDetail,findCover}=await import('../src/catalog.js');
test('起点按实际 rankNum 保留名次并提取 data-src 封面',()=>{
 const html='<html><head></head><body><img data-src="//bookcover.yuewen.com/qdbimg/349573/123/180"><script id="vite-plugin-ssr_pageContext" type="application/json">'+JSON.stringify({pageProps:{pageData:{records:[{bid:'123',bName:'测试书',bAuth:'甲',rankNum:7,cat:'科幻'}]}}})+'</script></body></html>';
 const books=parseOfficial('qidian',html);assert.equal(books[0].rank,7);assert.equal(books[0].author,'甲');assert.ok(books[0].cover.startsWith('https://bookcover.'));
});
test('晋江只取有名次的书籍行，关联同一行的作者',()=>{
 const html='<html><body><a href="onebook.php?novelid=9">导航广告</a><table><tr><td>3</td><td><a href="oneauthor.php?authorid=1">作者甲</a></td><td><a href="onebook.php?novelid=2" title="测试言情">测试言情</a></td><td>言情</td><td>完结</td></tr></table></body></html>';
 const books=parseOfficial('jinjiang',html);assert.equal(books.length,1);assert.equal(books[0].rank,3);assert.equal(books[0].author,'作者甲');assert.equal(books[0].status,'完结');
});
test('番茄读取公开初始榜单，不执行脚本',()=>{
 const state={rank:{book_list:[{bookId:'7',bookName:'测试',author:'甲',currentPos:4,creationStatus:'0',thumbUri:'https://example.com/cover.jpg'}]}};
 const books=parseOfficial('fanqie',`<html><body><script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script></body></html>`);
 assert.equal(books[0].title,'测试');assert.equal(books[0].rank,4);assert.equal(books[0].status,'完结');
});
test('通用章节源优先读取元数据与实际封面，不误取站点 logo',()=>{
 const html='<html><head><meta property="og:novel:book_name" content="测试小说"><meta property="og:novel:author" content="作者甲"><meta property="og:novel:status" content="完本"><meta property="og:image" content="/cover.jpg"></head><body><img src="/logo.png"><h1>错误标题</h1></body></html>';
 const {book}=parseSourceDetail(html,'https://example.com/book/1/',{name:'fixture',type:'chapter_scraper'});
 assert.equal(book.title,'测试小说');assert.equal(book.author,'作者甲');assert.equal(book.cover,'https://example.com/cover.jpg');assert.equal(book.status,'完本');
});
