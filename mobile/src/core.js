export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s《》〈〉【】「」『』·.,，。:：_\-]/g, '');
export const bookId = book => `${normalize(book.title)}|${normalize(book.author)}`;
export const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function webURL(value, base) {
  try { const u = new URL(value, base); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function decodeText(bytes, hint = '') {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder(hint || 'utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}
export function splitChapters(text) {
  const source = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const pattern = /^(?:[\t \u3000]*)(?:第[零〇一二三四五六七八九十百千万两\d]{1,12}[章回节卷部篇][^\n]{0,70}|(?:序章|楔子|引子|序言|前言|尾声|后记|终章|番外)[^\n]{0,60}|Chapter\s+\d+[^\n]{0,60})\s*$/gmi;
  const matches = [...source.matchAll(pattern)];
  const chapters = [];
  if (!matches.length) return [{title: '正文', start: 0, end: source.length}];
  if (matches[0].index > 0 && source.slice(0, matches[0].index).trim()) chapters.push({title:'卷首',start:0,end:matches[0].index});
  matches.forEach((m, i) => chapters.push({title:m[0].trim(),start:m.index,end:matches[i+1]?.index ?? source.length}));
  return chapters;
}
export function chapterAt(chapters, offset) {
  let low = 0, high = chapters.length - 1;
  while (low < high) { const mid = Math.ceil((low+high)/2); if (chapters[mid].start <= offset) low = mid; else high = mid-1; }
  return low;
}
export function sameBook(wanted, found, exact = true) {
  const a = normalize(wanted.title), b = normalize(found.title);
  if (!a || !b || (exact ? a !== b : !b.includes(a))) return false;
  const author = normalize(wanted.author), other = normalize(found.author);
  return Boolean(!author || (other && other !== '佚名' && author === other));
}
export function completed(book) { return /完结|完本|已完成|全本|completed|finished/i.test(book.status || ''); }
export function assertNotAborted(signal) { if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError'); }
export function coverPlaceholder(book) {
  const title = String(book.title || '未命名').slice(0,22);
  const author = escapeHTML(String(book.author || '本地书籍').slice(0,18));
  let n = 0; for (const c of title) n = (n*31+c.codePointAt(0))>>>0;
  const colors = [['#364f4b','#d8c89c'],['#755041','#eedcc5'],['#424d62','#d8dec8'],['#5b475b','#e3d4bd'],['#3b5966','#d4d8c5']][n%5];
  const lines = (title.match(/.{1,6}/gu) || ['未命名']).map(escapeHTML);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" viewBox="0 0 240 340"><rect width="240" height="340" fill="${colors[0]}"/><rect x="15" y="15" width="210" height="310" fill="none" stroke="${colors[1]}" opacity=".55"/><path d="M24 0v340" stroke="#000" opacity=".16" stroke-width="7"/><circle cx="185" cy="250" r="72" fill="none" stroke="${colors[1]}" opacity=".12" stroke-width="30"/>${lines.map((line,i)=>`<text x="120" y="${92+i*36}" text-anchor="middle" fill="${colors[1]}" font-family="serif" font-size="27">${line}</text>`).join('')}<text x="120" y="282" text-anchor="middle" fill="${colors[1]}" font-family="sans-serif" font-size="13">${author}</text><text x="120" y="307" text-anchor="middle" fill="${colors[1]}" opacity=".65" font-size="9">暂无原作封面 · 拾页</text></svg>`);
}
