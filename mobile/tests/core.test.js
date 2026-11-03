import test from 'node:test';
import assert from 'node:assert/strict';
import {splitChapters,chapterAt,decodeText,sameBook,coverPlaceholder,webURL} from '../src/core.js';
test('分章偏移无丢字，支持前言与中文章节',()=>{
 const text='前言文字\n\n第一章 初遇\n正文甲\n第二章 回声\n正文乙🌙';
 const parts=splitChapters(text);assert.equal(parts.length,3);assert.equal(parts.map(c=>text.slice(c.start,c.end)).join(''),text);
 assert.equal(chapterAt(parts,text.indexOf('正文乙')),2);
});
test('没有标题的 TXT 仍可阅读',()=>assert.deepEqual(splitChapters('只有正文'),[{title:'正文',start:0,end:4}]));
test('同名不同作者不能混配为可下载',()=>{
 assert.equal(sameBook({title:'《回声》',author:'甲'},{title:'回声',author:'乙'}),false);
 assert.equal(sameBook({title:'《回声》',author:'甲'},{title:'回声',author:''}),false);
 assert.equal(sameBook({title:'《回声》',author:'甲'},{title:'回声',author:'甲'}),true);
});
test('识别 UTF16、UTF8 和 GB18030',()=>{
 assert.equal(decodeText(new Uint8Array([0xff,0xfe,0x60,0x4f,0x7d,0x59])),'你好');
 assert.equal(decodeText(new Uint8Array([0xc4,0xe3,0xba,0xc3])),'你好');
 assert.equal(decodeText(new TextEncoder().encode('你好🌙')),'你好🌙');
});
test('占位封面正确转义，拒绝非网络 URL',()=>{
 const svg=decodeURIComponent(coverPlaceholder({title:'<script>"&',author:'A'}).split(',')[1]);
 assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;'));assert.ok(svg.includes('&gt;'));
 assert.equal(webURL('javascript:alert(1)','https://example.com/'),'');
});
