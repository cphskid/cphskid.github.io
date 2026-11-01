// 時光試煉島題庫：把 tools/quiz-bank/*.mjs 檢查過後寫成 supabase/park_quiz_bank.sql。
//   node tools/quiz-bank.mjs          檢查＋產生 SQL
//   node tools/quiz-bank.mjs --lint   另外列出每一題的審題燈號（紅／黃，規則見 tools/quiz-bank/lint.mjs）
//   node tools/quiz-bank.mjs --lint-json=檔名   燈號寫成 JSON（給 Claude 交叉檢查用）
// 匯進資料庫時，已經審過（不是 draft）的題目不會被蓋掉；要改審過的題，到後台題庫審核改。
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import * as soc from './quiz-bank/soc.mjs';
import * as sci from './quiz-bank/sci.mjs';
import { WHY } from './quiz-bank/why.mjs';
import { lint } from './quiz-bank/lint.mjs';

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
    if (WHY[id]) body.why = WHY[id]; else if (!(body.why?.length >= 30)) errs.push(`${id}：tools/quiz-bank/why.mjs 沒有這題的解析（題目裡的解析要 30 字以上才可以不寫在 why.mjs）`);
    if (body.why.length < 30) errs.push(`${id}：解析太短，要說明為什麼，不能只寫答案`);
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

// 考點覆蓋率（2026-11-01 Chuck 規則）：tools/curriculum/*.mjs 是考點清單，KP_PTS 標知識點對到哪些考點
const curDir = new URL('./curriculum/', import.meta.url);
const pts = new Map();   // 考點 id → { unit, text, game, part, items }
const books = [];
for (const f of readdirSync(curDir).filter((x) => x.endsWith('.mjs')).sort()) {
  const c = await import(new URL(f, curDir));
  books.push(c);
  for (const u of c.UNITS) for (const a of u.acts) for (const [id, text, game, part] of a.pts) {
    if (pts.has(id)) errs.push(`考點 ${id} 重複`);
    pts.set(id, { book: c.BOOK, unit: u, act: a.name, text, game, part: part === 'part', items: 0 });
  }
}
for (const [subject, b] of banks) {
  if (!b.KP_PTS) { warns.push(`${subject}：還沒有考點清單（tools/curriculum/）和 KP_PTS，看不出覆蓋率`); continue; }
  const map = b.KP_PTS;
  for (const k of kps.filter((x) => x.subject === subject)) {
    const list = map[k.id];
    if (!list) { warns.push(`${k.id}：還沒標對到哪個考點（KP_PTS）`); continue; }
    for (const id of list) {
      const p = pts.get(id);
      if (!p) errs.push(`${k.id}：KP_PTS 寫了不存在的考點 ${id}`); else p.items += count[k.id] ?? 0;
    }
  }
}
const coverage = [];
for (const c of books) {
  coverage.push(`\n考點覆蓋率：${c.BOOK.name}（有題＝對到的知識點至少 2 題）`);
  for (const u of c.UNITS) {
    const list = u.acts.flatMap((a) => a.pts.map(([id]) => pts.get(id)));
    const g = list.filter((p) => p.game && !p.part).length, gp = list.filter((p) => p.part).length, q = list.filter((p) => p.items >= 2).length;
    coverage.push(`  ${u.name}：${list.length} 考點｜遊戲有 ${g}、一點 ${gp}｜有題 ${q}（${Math.round(100 * q / list.length)}%）`);
    for (const a of u.acts) for (const [id, text] of a.pts) if (pts.get(id).items < 2) coverage.push(`    沒題  ${id} ${text}`);
  }
}

// 審題的程式檢核點（tools/quiz-bank/lint.mjs）：只標燈號，不擋 SQL
const srcDir = new URL('./curriculum/src/', import.meta.url);
const srcText = readdirSync(srcDir).filter((f) => f.endsWith('.md')).map((f) => readFileSync(new URL(f, srcDir), 'utf8')).join('\n');
const kpPts = Object.assign({}, ...banks.map(([, b]) => b.KP_PTS ?? {}));
const flags = lint(items, { kpPts, pts, srcText });
const lintJson = process.argv.find((a) => a.startsWith('--lint-json='));
if (lintJson) writeFileSync(lintJson.slice(12), JSON.stringify(flags, null, 1));
const tfs = items.filter((i) => i.kind === 'tf'), tfTrue = tfs.filter((i) => i.body.a).length;
const lintSum = `\n審題程式檢核：紅 ${new Set(flags.filter((f) => f.level === 'red').map((f) => f.id)).size} 題、黃 ${new Set(flags.filter((f) => f.level === 'yellow').map((f) => f.id)).size} 題（--lint 看明細）｜是非題 ${tfs.length} 題、答「對」${tfTrue}（${Math.round(100 * tfTrue / (tfs.length || 1))}%）`;

// 單選的答案原本在第幾個（網頁會洗牌，這裡只是看寫題時有沒有偏）
const pos = {};
for (const i of items) if (i.kind === 'mc') pos[i.body.a] = (pos[i.body.a] ?? 0) + 1;
const kinds = {};
for (const i of items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;

console.log(`知識點 ${kps.length}、題目 ${items.length}（社會 ${items.filter((i) => !i.kp.startsWith('sci-')).length}、自然 ${items.filter((i) => i.kp.startsWith('sci-')).length}）`);
console.log('題型', kinds, '單選答案原本的位置（會洗牌）', pos);
for (const w of warns) console.log('注意', w);
for (const l of coverage) console.log(l);
console.log(lintSum);
if (process.argv.includes('--lint')) for (const f of flags) console.log(f.level === 'red' ? '紅' : '黃', f.id, f.code, f.note);
if (errs.length) { for (const e of errs) console.error('錯誤', e); process.exit(1); }

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const j = (o) => (o == null ? 'null' : `${q(JSON.stringify(o))}::jsonb`);
// 審題燈號（tools/quiz-bank/review.json，Claude 交叉檢查的結果）：只寫進還在待審的題
let review = {};
try { review = JSON.parse(readFileSync(new URL('./quiz-bank/review.json', import.meta.url), 'utf8')); } catch { /* 還沒審過 */ }
const revRows = Object.entries(review).filter(([id]) => items.some((i) => i.id === id));
const reviewSql = revRows.length ? `
-- 審題燈號（tools/quiz-bank/review.json）：管理員在題庫審核看紅黃綠、抽查哪幾題
update public.quiz_item i set review = v.r
from (values
${revRows.map(([id, r]) => `  (${q(id)}, ${j(r)})`).join(',\n')}
) v(id, r)
where i.id = v.id and i.status = 'draft';
` : '';
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

-- 解析改寫過：審過、上架的題也換上新解析（只換解析，不影響改分；後台改過的題 ver>1 不動）
update public.quiz_item i set body = jsonb_set(i.body, '{why}', to_jsonb(v.why)), updated_at = now()
from (values
${items.map((i) => `  (${q(i.id)}, ${q(i.body.why)})`).join(',\n')}
) v(id, why)
where i.id = v.id and i.ver = 1 and i.body->>'why' is distinct from v.why;
${reviewSql}`;
writeFileSync(new URL('../supabase/park_quiz_bank.sql', import.meta.url), sql);
console.log('寫好 supabase/park_quiz_bank.sql');
