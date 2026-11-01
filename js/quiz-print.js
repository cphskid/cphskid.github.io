// 試煉卷印成紙本：每個孩子一份（選項順序和他在網頁上看到的一樣），可以附答案頁給家長對答案。
// r＝park_quiz_report 的結果；kids＝要印的孩子 id；key＝要不要附答案與解析
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (i) => 'ABCDEFGH'[i] ?? '?';
const HOW = {
  tf: '對的畫○，不對的畫✕。',
  mc: '選一個最好的答案，把代號寫在括號裡。',
  who: '哪一個人說得對？把代號寫在括號裡。',
  multi: '對的都要選，把代號都寫在括號裡。',
  order: '在括號裡寫 1、2、3……排出正確的順序。',
  cat: '每張卡片屬於哪一類？把類別代號寫在括號裡。',
  cloze: '每個空格選一個最合適的，把代號寫在括號裡。',
};

function ask(s, n) {
  const sh = s.show, k = s.kind;
  const opts = (list) => `<ol class="opts">${list.map((o, i) => `<li>${L(i)}. ${esc(o)}</li>`).join('')}</ol>`;
  let body = '';
  if (k === 'mc' || k === 'multi') body = opts(sh.opts);
  else if (k === 'who') body = opts(sh.says.map((x) => `${x.n}：「${x.t}」`));
  else if (k === 'order') body = `<ul class="steps">${sh.steps.map((t) => `<li>（　）${esc(t)}</li>`).join('')}</ul>`;
  else if (k === 'cat') body = `<p class="cats">${sh.cats.map((c, i) => `${L(i)}. ${esc(c)}`).join('　')}</p><ul class="steps">${sh.cards.map((t) => `<li>（　）${esc(t)}</li>`).join('')}</ul>`;
  else if (k === 'cloze') body = `<p class="passage">${esc(sh.text).replace(/\{(\d+)\}/g, (_, i) => `（${+i + 1}）＿＿＿`)}</p>`
    + sh.blanks.map((o, i) => `<p class="blank">（${i + 1}）（　）　${o.map((t, j) => `${L(j)}. ${esc(t)}`).join('　')}</p>`).join('');
  const box = k === 'order' || k === 'cat' || k === 'cloze' ? '' : '<span class="ans">（　　）</span>';
  return `<li class="q"><div class="qh">${box}<b>${n}.</b> ${esc(sh.q)}</div>${body}</li>`;
}

function keyText(s) {
  const sh = s.show, v = s.key, k = s.kind;
  if (k === 'tf') return v ? '○' : '✕';
  if (k === 'mc') return `${L(v)}. ${sh.opts[v]}`;
  if (k === 'who') return `${L(v)}. ${sh.says[v]?.n}`;
  if (k === 'multi') return v.map((i) => `${L(i)}. ${sh.opts[i]}`).join('、');
  if (k === 'order') return v.map((i) => sh.steps[i]).join(' → ');
  if (k === 'cat') return sh.cards.map((c, i) => `${c}：${L(v[i])}`).join('；');
  if (k === 'cloze') return sh.blanks.map((o, i) => `（${i + 1}）${L(v[i])}. ${o[v[i]]}`).join('　');
  return '';
}

const CSS = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; color: #222; margin: 0; font-size: 12.5pt; line-height: 1.6; }
  .kid { page-break-after: always; }
  .kid:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 10px; }
  header h1 { font-size: 17pt; margin: 0; }
  header .who { font-size: 12pt; white-space: nowrap; }
  .tip { font-size: 10.5pt; color: #555; margin: 0 0 8px; break-after: avoid; page-break-after: avoid; }
  h2 { font-size: 13pt; margin: 14px 0 6px; padding: 2px 8px; background: #eee; border-radius: 4px; }
  ol.qs { list-style: none; padding: 0; margin: 0; }
  li.q { break-inside: avoid; margin: 0 0 12px; }
  .qh { display: flex; gap: 6px; }
  .ans { white-space: nowrap; }
  ol.opts { list-style: none; padding-left: 3.6em; margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 2px 22px; }
  ul.steps { list-style: none; padding-left: 2.2em; margin: 4px 0 0; }
  .cats, .passage, .blank { margin: 4px 0 0 2.2em; }
  .keys li { break-inside: avoid; margin-bottom: 8px; }
  .keys .why { color: #444; font-size: 11pt; }
  .noprint { position: sticky; top: 0; background: #fff8e1; padding: 10px; text-align: center; border-bottom: 1px solid #ddd; font-size: 12pt; }
  .noprint button { font-size: 13pt; padding: 6px 18px; margin-left: 8px; }
  main { padding: 0 4mm; }
  @media print { .noprint { display: none; } main { padding: 0; } }
`;

export function printPaper(r, kidIds, { key = true } = {}) {
  const kids = r.kids.filter((k) => kidIds.includes(k.id) && k.slots?.length);
  const date = new Date(r.at).toLocaleDateString('zh-TW');
  const papers = [], answers = [];
  kids.forEach((k) => {
    const groups = [];
    for (const [i, s] of k.slots.entries()) {
      const last = groups[groups.length - 1];
      if (last && last.kind === s.kind) last.list.push([i + 1, s]); else groups.push({ kind: s.kind, list: [[i + 1, s]] });
    }
    const paper = `<section class="kid"><header><h1>${esc(r.title)}</h1><div class="who">姓名：${esc(k.nickname)}　　日期：${date}　　得分：＿＿＿</div></header>
      ${groups.map((g) => `<p class="tip">${HOW[g.kind]}</p><ol class="qs">${g.list.map(([n, s]) => ask(s, n)).join('')}</ol>`).join('')}</section>`;
    const keys = key ? `<section class="kid"><header><h1>${esc(r.title)}・答案與解析</h1><div class="who">${esc(k.nickname)}</div></header>
      <p class="tip">給家長對答案用。每個孩子的選項順序不一樣，請對照孩子名字的這一頁。</p>
      <ol class="qs keys">${k.slots.map((s, i) => `<li><b>${i + 1}.</b> ${esc(keyText(s))}<div class="why">💡 ${esc(s.body?.why ?? '')}</div></li>`).join('')}</ol></section>` : '';
    papers.push(paper); answers.push(keys);
  });
  const pages = papers.join('') + answers.join('');   // 先全部的卷、答案集中在最後，方便抽出來
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>${CSS}</style></head>
    <body><div class="noprint">共 ${kids.length} 個孩子${key ? '，每人一份卷，答案與解析在最後' : ''}。<button onclick="print()">🖨 列印</button></div><main>${pages}</main></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* 使用者自己按列印 */ } }, 400);
  return true;
}
