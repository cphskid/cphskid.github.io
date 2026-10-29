// 時光試煉島題庫：把 tools/quiz-bank/*.mjs 檢查過後寫成 supabase/park_quiz_bank.sql。
//   node tools/quiz-bank.mjs          檢查＋產生 SQL
// 匯進資料庫時，已經審過（不是 draft）的題目不會被蓋掉；要改審過的題，到後台題庫審核改。
import { writeFileSync } from 'node:fs';
import * as soc from './quiz-bank/soc.mjs';
import * as sci from './quiz-bank/sci.mjs';

const kps = [], items = [], errs = [], warns = [];
const banks = [['soc', soc], ['sci', sci]];
let sort = 0;
for (const [subject, b] of banks) {
  for (const [id, place, name, book, game] of b.KPS) kps.push({ id, subject, place, name, book, game: game ?? null, sort: ++sort });
}
const kpIds = new Set(kps.map((k) => k.id));
const count = {};
for (const [, b] of banks) {
  for (const [kp, level, src, { kind, body }] of b.ITEMS) {
    count[kp] = (count[kp] ?? 0) + 1;
    const id = `${kp}-${count[kp]}`;
    items.push({ id, kp, level, src, kind, body });
    if (!kpIds.has(kp)) errs.push(`${id}：沒有這個知識點`);
    if (!src) errs.push(`${id}：沒寫出處`);
    for (const e of check(kind, body)) errs.push(`${id}：${e}`);
  }
}
for (const k of kps) if ((count[k.id] ?? 0) < 2) warns.push(`${k.id}：只有 ${count[k.id] ?? 0} 題，學會判定要不同題答對兩次，至少要 2 題`);
const seenQ = new Map();
for (const i of items) {
  const key = i.body.q + (i.body.text ?? '');
  if (seenQ.has(key)) errs.push(`${i.id}：和 ${seenQ.get(key)} 題目一樣`);
  seenQ.set(key, i.id);
}

// 和資料庫 quiz_check 一樣的規則，再加幾條只在這裡檢查的（選項長短、答案位置）
function check(kind, b) {
  const e = [];
  if (!b.q || b.q.length < 4) e.push('題目太短');
  if (b.q?.length > 160) e.push('題目太長');
  if (!b.why || b.why.length < 6) e.push('沒有解析');
  const bad = /以上皆是|以上皆非/;
  if (bad.test(b.q)) e.push('用了以上皆是／皆非');
  if (kind === 'tf' && typeof b.a !== 'boolean') e.push('是非答案要 true/false');
  if (kind === 'mc' || kind === 'multi') {
    if (b.opts.length < 3 || b.opts.length > 5) e.push('選項要 3～5 個');
    if (new Set(b.opts).size !== b.opts.length) e.push('選項重複');
    if (b.opts.some((o) => !o.trim() || bad.test(o))) e.push('選項空的或以上皆是');
    if (kind === 'mc' && !(Number.isInteger(b.a) && b.a < b.opts.length)) e.push('答案沒指到選項');
    if (kind === 'multi' && !(b.a.length >= 2 && b.a.length < b.opts.length && b.a.every((x) => x < b.opts.length))) e.push('多選答案要 2 個以上、不能全選');
    if (kind === 'mc') {
      const len = b.opts.map((o) => [...o].length), right = len[b.a], other = Math.max(...len.filter((_, i) => i !== b.a));
      if (right > other * 1.8 && right - other > 6) warns.push(`「${b.q.slice(0, 14)}」正確答案比其他選項長很多`);
    }
  }
  if (kind === 'who') {
    if (b.says.length < 3 || b.says.length > 4) e.push('要 3～4 個人');
    if (!(b.a < b.says.length)) e.push('答案沒指到人');
  }
  if (kind === 'order' && (b.steps.length < 3 || b.steps.length > 5)) e.push('排序要 3～5 個');
  if (kind === 'cat') {
    if (b.cats.length < 2 || b.cats.length > 4) e.push('分類要 2～4 類');
    if (b.cards.length < 3 || b.cards.length > 6) e.push('卡片要 3～6 張');
    if (b.cards.some((c) => !(c.c < b.cats.length))) e.push('卡片沒指到類別');
  }
  if (kind === 'cloze') {
    b.blanks.forEach((x, i) => {
      if (!b.text.includes(`{${i}}`)) e.push(`短文少了 {${i}}`);
      if (x.opts.length < 2 || x.opts.length > 4 || !(x.a < x.opts.length)) e.push(`第 ${i + 1} 格不對`);
    });
  }
  return e;
}

// 單選的答案原本在第幾個（網頁會洗牌，這裡只是看寫題時有沒有偏）
const pos = {};
for (const i of items) if (i.kind === 'mc') pos[i.body.a] = (pos[i.body.a] ?? 0) + 1;
const kinds = {};
for (const i of items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;

console.log(`知識點 ${kps.length}、題目 ${items.length}（社會 ${items.filter((i) => !i.kp.startsWith('sci-')).length}、自然 ${items.filter((i) => i.kp.startsWith('sci-')).length}）`);
console.log('題型', kinds, '單選答案原本的位置（會洗牌）', pos);
for (const w of warns) console.log('注意', w);
if (errs.length) { for (const e of errs) console.error('錯誤', e); process.exit(1); }

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const j = (o) => (o == null ? 'null' : `${q(JSON.stringify(o))}::jsonb`);
const sql = `-- 時光試煉島題庫（tools/quiz-bank.mjs 產生，不要手改）。知識點 ${kps.length}、題目 ${items.length}。
-- 題目一律先 draft（待審），管理員在老師後台「題庫審核」看過才會被抽到。
-- 重跑時：知識點會更新；題目只更新還是 draft 的（審過的不蓋掉）。
insert into public.quiz_kp (id, subject, place, name, book, game, sort) values
${kps.map((k) => `  (${q(k.id)}, ${q(k.subject)}, ${q(k.place)}, ${q(k.name)}, ${q(k.book)}, ${j(k.game)}, ${k.sort})`).join(',\n')}
on conflict (id) do update set subject = excluded.subject, place = excluded.place, name = excluded.name,
  book = excluded.book, game = excluded.game, sort = excluded.sort;

insert into public.quiz_item (id, kp, kind, level, body, src, status) values
${items.map((i) => `  (${q(i.id)}, ${q(i.kp)}, ${q(i.kind)}, ${i.level}, ${j(i.body)}, ${q(i.src)}, 'draft')`).join(',\n')}
on conflict (id) do update set kp = excluded.kp, kind = excluded.kind, level = excluded.level, body = excluded.body,
  src = excluded.src, updated_at = now()
  where public.quiz_item.status = 'draft';
`;
writeFileSync(new URL('../supabase/park_quiz_bank.sql', import.meta.url), sql);
console.log('寫好 supabase/park_quiz_bank.sql');
