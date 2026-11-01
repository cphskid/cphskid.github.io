// 審題的程式檢核點（2026-11-01 Chuck 定的審題原則，doc https://claude.ai/artifact/SZmXurQ8KfNA5DrG7Qb7dh）。
// 只標燈號、不擋產生 SQL：紅＝一定要人或 Claude 處理才能上架；黃＝Claude 先修。
// 格式類的硬規則（選項數、以上皆是…）在 quiz-bank.mjs 的 check()，不通過直接擋。
//
// lint(items, { kpPts, pts, srcText }) → [{ id, level: 'red'|'yellow', code, note }]
//   items   產生器裡的題目 { id, kp, kind, body }
//   kpPts   知識點 → 考點 id 陣列（KP_PTS）
//   pts     考點 id → { text }
//   srcText 教材原文（tools/curriculum/src/*.md）合起來的字串

const NEG = /不是|錯誤|不正確|不對|不屬於|不會|不能|沒有|何者非/;
const NEG2 = /(不|沒).{0,6}(不|沒|非)/;
const ABS = /一定|絕對|從來|從不|永遠|完全|全部都|所有.{0,6}都|只要.{0,8}就/;

// 正確答案的文字（給數字檢查和長度檢查用）
export function answerText(kind, b) {
  if (kind === 'tf') return b.a ? b.q : '';
  if (kind === 'mc') return b.opts[b.a] ?? '';
  if (kind === 'multi') return b.a.map((i) => b.opts[i]).join('、');
  if (kind === 'who') return b.says[b.a]?.t ?? '';
  if (kind === 'order') return b.steps.join('、');
  if (kind === 'cat') return b.cards.map((c) => `${c.t}${b.cats[c.c]}`).join('、');
  if (kind === 'cloze') return b.blanks.map((x) => x.opts[x.a]).join('、');
  return '';
}

const bigrams = (s) => {
  const t = [...s.replace(/[\s，。、？！「」（）()?,.]/g, '')], out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t[i] + t[i + 1]);
  return out;
};
const jaccard = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};
const nums = (s) => (s.match(/\d[\d,，]*(\.\d+)?/g) ?? []).map((x) => x.replace(/[,，]/g, '')).filter((x) => x.length >= 2);

export function lint(items, { kpPts, pts, srcText }) {
  const out = [];
  const flag = (id, level, code, note) => out.push({ id, level, code, note });
  const src = srcText.replace(/[,，]/g, '');
  const byKp = {};
  for (const i of items) (byKp[i.kp] ??= []).push(i);

  for (const i of items) {
    const b = i.body, q = b.q + (b.text ?? '');
    // 1 對到考點
    const list = kpPts[i.kp] ?? [];
    if (!list.length) flag(i.id, 'red', 'NOPOINT', '知識點還沒對到考點清單');
    // 6 否定問法（是非題本身就是判斷句，不算）
    if (i.kind !== 'tf' && NEG.test(b.q)) flag(i.id, 'yellow', 'NEG', `題目用否定問法：${b.q.match(NEG)[0]}`);
    if (NEG2.test(b.q)) flag(i.id, 'yellow', 'NEG', '題目可能有雙重否定');
    // 7 送分字眼：出現在選項（或是非題題目）
    const opts = b.opts ?? b.says?.map((s) => s.t) ?? [];
    const absIn = opts.filter((o) => ABS.test(o));
    if (absIn.length) flag(i.id, 'yellow', 'GIVEAWAY', `選項有絕對字眼：${absIn[0].match(ABS)[0]}`);
    if (i.kind === 'tf' && ABS.test(b.q)) flag(i.id, 'yellow', 'GIVEAWAY', `是非題有絕對字眼：${b.q.match(ABS)[0]}（容易猜「錯」）`);
    // 9 題目和正確答案裡的數字，要在考點清單或教材原文找得到
    const ptText = list.map((id) => pts.get(id)?.text ?? '').join(' ').replace(/[,，]/g, '');
    for (const n of new Set([...nums(q), ...nums(answerText(i.kind, b))])) {
      if (!ptText.includes(n) && !src.includes(n)) flag(i.id, 'yellow', 'NUM', `數字 ${n} 在考點清單和教材原文都找不到`);
    }
  }
  // 8 同一個知識點裡兩題太像
  for (const list of Object.values(byKp)) {
    const g = list.map((i) => [i, bigrams(i.body.q + (i.body.text ?? ''))]);
    for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
      const s = jaccard(g[x][1], g[y][1]);
      if (s >= 0.6) flag(g[y][0].id, 'yellow', 'SIMILAR', `和 ${g[x][0].id} 題目很像（${Math.round(s * 100)}%）`);
    }
  }
  return out;
}
