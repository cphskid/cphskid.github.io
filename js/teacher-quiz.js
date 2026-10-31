// 老師後台「時光試煉島」頁籤：出卷（照錯題自動挑、家長再調）、出過的卷、分析報告、學習地圖；管理員多一個題庫審核。
// 規則（學會、挑題比例、報告判讀）在 js/quiz-core.js；改分在資料庫（supabase/park_quiz.sql）。
import { quiz } from './auth.js';
import { kidStates, pickPaper, readSlot, PLACE_NAME, STATE_NAME, placeZone, placeGame, EXAMS } from './quiz-core.js';
import { resultHtml, KIND_NAME } from './quiz-items.js';
import { openEditor } from './quiz-edit.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUCKET = { weak: ['待加強', 'b-weak'], seen: ['玩過還沒學會', 'b-seen'], new: ['還沒玩過', 'b-new'], review: ['抽查', 'b-review'], pick: ['自己選的', 'b-pick'] };
const date = (t) => new Date(t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });

let ctx = null;          // { view, classes, active, setActive, toast, admin }
let sub = 'new';         // new 出新卷／papers 出過的卷／map 學習地圖／bank 題庫審核
let cache = { code: null, bank: null, klass: null };
let draft = null;        // 出卷中：{ kids:[id], mode, n, subjects, places, plan:{kid:[{item,bucket}]}, at }
let stale = false;       // 題庫審核改過題目：回到出卷頁要重讀題庫

export async function renderQuiz(view, c) {
  ctx = { ...c, view };
  if (!ctx.classes.length && !ctx.admin) {
    view.innerHTML = `<section class="panel"><div class="empty"><img src="img/admin/tick-empty.webp" alt="">
      <p>先到「我的班級」開一個班，孩子加入以後就可以出試煉卷。</p></div></section>`;
    return;
  }
  if (sub === 'bank' && !ctx.admin) sub = 'new';
  await paint();
}

async function load(force = false) {
  const code = ctx.active;
  if (!code) return;
  if (force || cache.code !== code) {
    const [bank, klass] = await Promise.all([quiz.bank(code), quiz.klass(code)]);
    if (cache.code !== code) draft = null;   // 換班才清掉出到一半的卷；同一班重讀題庫時保留
    else if (draft) draft.plan = null;      // 題庫變了，之前挑的題可能下架，請重新挑
    cache = { code, bank, klass, kp: new Map(bank.kps.map((k) => [k.id, k])), item: new Map(bank.items.map((i) => [i.id, i])) };
    stale = false;
  }
}

async function paint() {
  const { view, classes } = ctx;
  const tabs = [['new', '出新卷'], ['papers', '出過的卷'], ['map', '學習地圖'], ...(ctx.admin ? [['bank', '題庫審核（管理員）']] : [])];
  view.innerHTML = `
  <section class="panel">
    <div class="head"><h2><img class="hi" src="img/admin/quiz.webp" alt="">時光試煉島</h2></div>
    <p class="lead">依孩子在遊戲和試煉卷裡的對錯自動挑題，你再調整。孩子會收到信鴿信，到樂園外的「時光試煉島」作答；
      交卷後這裡看得到每一題的對錯、和遊戲裡的比較、該翻課本哪一段。</p>
    ${classes.length ? `<div class="classtabs" role="tablist">${classes.map((c) => `
      <button role="tab" data-code="${esc(c.code)}" class="${c.code === ctx.active ? 'on' : ''}"><b>${esc(c.name || c.code)}</b>
      <small>${c.kind === 'home' ? '家庭班' : '學校班'}・${c.members} 人</small></button>`).join('')}</div>` : ''}
    <div class="qt-sub">${tabs.map(([k, t]) => `<button class="chip${sub === k ? ' on' : ''}" data-sub="${k}">${t}</button>`).join('')}</div>
  </section>
  <div id="qt"></div>`;
  $$('.classtabs [data-code]', view).forEach((b) => { b.onclick = () => { ctx.setActive(b.dataset.code); ctx.active = b.dataset.code; paint(); }; });
  $$('[data-sub]', view).forEach((b) => { b.onclick = () => { sub = b.dataset.sub; paint(); }; });
  const box = $('#qt', view);
  box.innerHTML = '<p class="loading"><img src="img/tick/boat.webp" alt="">讀取中…</p>';
  try {
    if (sub === 'bank') return await paintBank(box);
    if (!ctx.active) { box.innerHTML = ''; return; }
    await load(stale);
    if (sub === 'papers') await paintPapers(box);
    else if (sub === 'map') paintMap(box);
    else if (sub.startsWith('report:')) await paintReport(box, sub.slice(7));
    else paintNew(box);
  } catch (e) {
    box.innerHTML = `<section class="panel"><div class="empty"><img src="img/admin/tick-error.webp" alt=""><p>${esc(e.message)}</p></div></section>`;
  }
}

const kidsOf = () => cache.klass.kids;
const statesOf = (kid) => kidStates(kid, cache.bank.kps);
const placesOf = (subjects) => [...new Set(cache.bank.kps.filter((k) => subjects.has(k.subject)).map((k) => k.place))];

// =============================================================================
// 出新卷
// =============================================================================
function paintNew(box) {
  const kids = kidsOf();
  if (!kids.length) {
    box.innerHTML = '<section class="panel"><div class="empty"><img src="img/admin/tick-empty.webp" alt=""><p>這個班還沒有孩子。</p></div></section>';
    return;
  }
  if (!draft) {
    const home = cache.klass.kind === 'home';
    draft = { kids: kids.map((k) => k.id), mode: home || kids.length <= 3 ? 'each' : 'same', n: 20,
              subjects: new Set(['soc', 'sci']), places: null, plan: null, at: kids[0].id, title: `試煉卷 ${date(Date.now())}` };
  }
  const live = cache.bank.items.length;
  const allPlaces = placesOf(draft.subjects);
  const placeOn = (p) => !draft.places || draft.places.has(p);
  box.innerHTML = `
  <section class="panel">
    ${live ? '' : `<p class="warn">題庫裡還沒有審核通過的題目，管理員審完才出得了卷。<button class="ghost small" id="qt-reload">↻ 重新讀取題庫</button></p>`}
    <div class="qt-form">
      <label>卷名<input id="qt-title" maxlength="30" value="${esc(draft.title)}"></label>
      <div><b>給誰寫</b> <small id="qt-kidn">選了 ${draft.kids.length}／${kids.length} 人</small>
        ${kids.length > 1 ? '<span class="qt-all"><button type="button" class="ghost small" data-all="1">全選</button><button type="button" class="ghost small" data-all="0">全部取消</button></span>' : ''}
        <div class="chips">${kids.map((k) => `<label class="chip"><input type="checkbox" data-kid="${k.id}" ${draft.kids.includes(k.id) ? 'checked' : ''}>${esc(k.nickname)}</label>`).join('')}</div></div>
      <div><b>怎麼挑</b><div class="chips">
        <label class="chip"><input type="radio" name="mode" value="each" ${draft.mode === 'each' ? 'checked' : ''}>每個孩子照自己的錯題挑（建議）</label>
        <label class="chip"><input type="radio" name="mode" value="same" ${draft.mode === 'same' ? 'checked' : ''}>大家同一份</label></div></div>
      <div><b>題數</b><div class="chips">${[10, 20, 30].map((n) => `<label class="chip"><input type="radio" name="n" value="${n}" ${draft.n === n ? 'checked' : ''}>${n} 題${n === 30 ? '（可以分兩次寫）' : ''}</label>`).join('')}</div></div>
      <div><b>依考試圈範圍</b>
        <select id="qt-exam"><option value="">不限（全部都考）</option>${EXAMS.map((e) => `<option value="${e.id}" ${draft.exam === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        ${draft.exam ? `<small class="tip">照康軒一般進度先圈好了，各校範圍不太一樣，請對照學校的範圍通知單，在下面加減章節${draft.examEdited ? '（已調整）' : ''}。</small>` : ''}</div>
      <div><b>考哪些遊戲</b><div class="chips">
        <label class="chip"><input type="checkbox" data-subj="soc" ${draft.subjects.has('soc') ? 'checked' : ''}>島嶼開拓者（社會）</label>
        <label class="chip"><input type="checkbox" data-subj="sci" ${draft.subjects.has('sci') ? 'checked' : ''}>時光祕境島（自然）</label></div></div>
      <details ${draft.places ? 'open' : ''}><summary><b>只考某幾章</b>（不選＝全部，沒玩過的也會出一點）</summary>
        <div class="chips">${allPlaces.map((p) => `<label class="chip"><input type="checkbox" data-place="${p}" ${placeOn(p) ? 'checked' : ''}>${esc(PLACE_NAME[p] ?? p)}</label>`).join('')}</div></details>
    </div>
    <p class="tip">自動挑題：5 成是孩子<b>待加強</b>的、3 成是<b>玩過還沒學會</b>的、2 成是<b>還沒玩過</b>的；已經學會的不出（學會超過 30 天的偶爾抽查），答對過的原題不會再出。</p>
    <div class="row"><button class="btn go" id="qt-pick" ${live ? '' : 'disabled'}>${draft.plan ? '重新自動挑題' : '自動挑題'}</button></div>
  </section>
  <div id="qt-plan"></div>`;
  const read = () => {
    draft.title = $('#qt-title').value.trim() || draft.title;
    draft.kids = $$('[data-kid]', box).filter((x) => x.checked).map((x) => x.dataset.kid);
    draft.mode = $('[name=mode]:checked', box).value;
    draft.n = +$('[name=n]:checked', box).value;
    draft.subjects = new Set($$('[data-subj]', box).filter((x) => x.checked).map((x) => x.dataset.subj));
    const ps = $$('[data-place]', box);
    draft.places = ps.every((x) => x.checked) ? null : new Set(ps.filter((x) => x.checked).map((x) => x.dataset.place));
  };
  $$('[data-subj]', box).forEach((x) => { x.onchange = () => { read(); draft.places = null; draft.exam = null; paintNew(box); }; });
  $('#qt-exam').onchange = (e) => {
    read();
    const ex = EXAMS.find((x) => x.id === e.target.value);
    const autoTitle = !draft.exam ? draft.title.startsWith('試煉卷') : draft.title === `${EXAMS.find((x) => x.id === draft.exam)?.name} 複習`;
    draft.exam = ex?.id ?? null; draft.examEdited = false;
    if (ex) {
      const zones = new Set(ex.places.map((p) => (placeZone(p) === 'science' ? 'sci' : 'soc')));
      draft.subjects = zones;
      draft.places = new Set(ex.places);
      if (autoTitle) draft.title = `${ex.name} 複習`;
    } else { draft.subjects = new Set(['soc', 'sci']); draft.places = null; }
    paintNew(box);
  };
  $$('[data-place]', box).forEach((x) => { x.addEventListener('change', () => { if (draft.exam && !draft.examEdited) { draft.examEdited = true; const t = $('#qt-exam + .tip'); if (t) t.textContent = t.textContent.replace('。', '（已調整）。').replace(/（已調整）（已調整）/, '（已調整）'); } }); });
  $('#qt-title').onchange = read;
  const kidCount = () => { $('#qt-kidn').textContent = `選了 ${$$('[data-kid]:checked', box).length}／${kids.length} 人`; };
  $$('[data-kid]', box).forEach((x) => { x.onchange = kidCount; });
  $$('[data-all]', box).forEach((b) => { b.onclick = () => { $$('[data-kid]', box).forEach((x) => { x.checked = b.dataset.all === '1'; }); kidCount(); }; });
  $('#qt-reload')?.addEventListener('click', async () => { await load(true); paintNew(box); });
  $('#qt-pick').onclick = () => {
    read();
    if (!draft.kids.length) return ctx.toast('至少選一個孩子', true);
    if (!draft.subjects.size) return ctx.toast('至少選一個遊戲', true);
    autoPick();
    if (!draft.kids.includes(draft.at)) draft.at = draft.kids[0];
    paintPlan($('#qt-plan'));
  };
  if (draft.plan) paintPlan($('#qt-plan'));
}

function autoPick() {
  const opt = { n: draft.n, subjects: draft.subjects, places: draft.places };
  const kids = kidsOf().filter((k) => draft.kids.includes(k.id));
  draft.plan = {};
  if (draft.mode === 'each') {
    for (const k of kids) draft.plan[k.id] = pickPaper(cache.bank, statesOf(k), opt);
  } else {
    // 大家同一份：知識點取「最需要加強的那個孩子」的狀態；答對過的原題只有大家都答對過才不出
    const rank = { weak: 0, seen: 1, new: 2, learned: 3 };
    const all = kids.map(statesOf), merged = {};
    for (const kp of Object.keys(all[0] ?? {})) {
      const list = all.map((s) => s[kp]);
      const worst = list.reduce((a, b) => (rank[b.state] < rank[a.state] ? b : a));
      const right = list.slice(1).reduce((acc, s) => new Set([...acc].filter((x) => s.rightItems.has(x))), list[0].rightItems);
      merged[kp] = { ...worst, rightItems: right, due: list.some((s) => s.due) };
    }
    const one = pickPaper(cache.bank, merged, opt);
    for (const k of kids) draft.plan[k.id] = one.map((x) => ({ ...x }));
  }
}

function paintPlan(box) {
  const kids = kidsOf().filter((k) => draft.kids.includes(k.id));
  const each = draft.mode === 'each';
  const list = draft.plan[draft.at] ?? [];
  const short = list.length < draft.n;
  box.innerHTML = `
  <section class="panel">
    <div class="head"><h2>預覽與調整</h2><span class="tag">${list.length} 題</span></div>
    ${each && kids.length > 1 ? `<div class="chips">${kids.map((k) => `<button class="chip${k.id === draft.at ? ' on' : ''}" data-at="${k.id}">${esc(k.nickname)}（${draft.plan[k.id]?.length ?? 0}）</button>`).join('')}</div>` : ''}
    ${short ? `<p class="warn">題庫裡能出的題只有 ${list.length} 題（審過的、這個孩子還沒答對過的）。可以加入自己出的題，或少出幾題。</p>` : ''}
    <ol class="qt-plan">${list.map((x, i) => planRow(x, i)).join('')}</ol>
    <div class="row">
      <select id="qt-addkp"><option value="">＋ 從題庫加一題：選知識點…</option>${cache.bank.kps.filter((k) => draft.subjects.has(k.subject)).map((k) => `<option value="${k.id}">${esc(PLACE_NAME[k.place] ?? k.place)}｜${esc(k.name)}</option>`).join('')}</select>
      <button class="ghost small" id="qt-own">✎ 自己出一題</button>
    </div>
    <div id="qt-ownform"></div>
    <p class="tip">${each ? '每個孩子的卷題數要一樣。' : '大家拿到一樣的題目，選項順序每個人不同。'}孩子交卷前看不到答案；交卷後看得到正確答案和解析。</p>
    <div class="row"><button class="btn go" id="qt-send">寄出試煉卷</button></div>
  </section>`;
  $$('[data-at]', box).forEach((b) => { b.onclick = () => { draft.at = b.dataset.at; paintPlan(box); }; });
  const targets = () => (each ? [draft.at] : kids.map((k) => k.id));
  $$('[data-del]', box).forEach((b) => { b.onclick = () => { for (const id of targets()) draft.plan[id].splice(+b.dataset.del, 1); paintPlan(box); }; });
  $$('[data-swap]', box).forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.swap, cur = list[i], it = cache.item.get(cur.item);
      const taken = new Set(list.map((x) => x.item));
      const kid = kidsOf().find((k) => k.id === draft.at), st = statesOf(kid);
      const same = cache.bank.items.filter((o) => o.kp === it.kp && !taken.has(o.id) && !st[o.kp]?.rightItems.has(o.id));
      const near = cache.bank.items.filter((o) => cache.kp.get(o.kp)?.place === cache.kp.get(it.kp)?.place && !taken.has(o.id) && !st[o.kp]?.rightItems.has(o.id));
      const pool = same.length ? same : near;
      if (!pool.length) return ctx.toast('這一章沒有別的題可以換了', true);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      for (const id of targets()) draft.plan[id][i] = { item: pick.id, bucket: cur.bucket };
      paintPlan(box);
    };
  });
  $('#qt-addkp').onchange = (e) => {
    const kp = e.target.value; if (!kp) return;
    const taken = new Set(list.map((x) => x.item));
    const pool = cache.bank.items.filter((o) => o.kp === kp && !taken.has(o.id));
    if (!pool.length) { ctx.toast('這個知識點的題目都已經在卷上了', true); e.target.value = ''; return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    for (const id of targets()) draft.plan[id].push({ item: pick.id, bucket: 'pick' });
    paintPlan(box);
  };
  $('#qt-own').onclick = () => ownForm($('#qt-ownform'), (id) => { for (const k of targets()) draft.plan[k].push({ item: id, bucket: 'pick' }); paintPlan(box); });
  $('#qt-send').onclick = async (e) => {
    const plan = kids.map((k) => ({ student: k.id, items: draft.plan[k.id] ?? [] }));
    const lens = new Set(plan.map((p) => p.items.length));
    if (lens.size > 1) return ctx.toast('每個孩子的題數要一樣，請調整一下', true);
    if (!plan[0]?.items.length) return ctx.toast('卷上還沒有題目', true);
    if (plan[0].items.length > 30) return ctx.toast('一張卷最多 30 題', true);
    e.target.disabled = true;
    try {
      await quiz.create(ctx.active, draft.title, plan);
      ctx.toast(`寄出了！${kids.length} 個孩子會收到信鴿信。`);
      draft = null; sub = 'papers'; paint();
    } catch (err) { e.target.disabled = false; ctx.toast(err.message, true); }
  };
}

function planRow(x, i) {
  const it = cache.item.get(x.item), k = cache.kp.get(it?.kp);
  if (!it) return `<li class="qt-row"><span>（這題已停用）</span><button class="ghost small" data-del="${i}">✕</button></li>`;
  const [bn, bc] = BUCKET[x.bucket] ?? BUCKET.pick;
  return `<li class="qt-row">
    <div class="qt-row-h"><span class="qt-b ${bc}">${bn}</span><small>${esc(PLACE_NAME[k?.place] ?? '')}｜${esc(k?.name ?? '')}｜${KIND_NAME[it.kind]}${it.own ? '｜自己出的' : ''}</small>
      <span class="spacer"></span><button class="ghost small" data-swap="${i}" title="換一題">⇄ 換</button><button class="ghost small" data-del="${i}" title="拿掉">✕</button></div>
    <details><summary>${esc(it.body.q)}</summary>${preview(it)}</details></li>`;
}

// 老師看的題目（原本的順序，標出答案）
export function preview(it) {
  const b = it.body, ok = (on) => (on ? ' class="qt-right"' : '');
  let s = '';
  if (it.kind === 'tf') s = `<p>答案：<b>${b.a ? '對' : '不對'}</b></p>`;
  else if (it.kind === 'mc') s = `<ol type="A">${b.opts.map((o, i) => `<li${ok(i === b.a)}>${esc(o)}</li>`).join('')}</ol>`;
  else if (it.kind === 'multi') s = `<ul>${b.opts.map((o, i) => `<li${ok(b.a.includes(i))}>${b.a.includes(i) ? '☑' : '☐'} ${esc(o)}</li>`).join('')}</ul>`;
  else if (it.kind === 'who') s = `<ul>${b.says.map((x, i) => `<li${ok(i === b.a)}>${esc(x.n)}：「${esc(x.t)}」</li>`).join('')}</ul>`;
  else if (it.kind === 'order') s = `<ol>${b.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol><small>（上面是正確順序，孩子看到的是打亂的）</small>`;
  else if (it.kind === 'cat') s = `<ul>${b.cards.map((c) => `<li>${esc(c.t)} → <b>${esc(b.cats[c.c])}</b></li>`).join('')}</ul>`;
  else if (it.kind === 'cloze') s = `<p>${esc(b.text).replace(/\{(\d+)\}/g, (_, i) => `<b class="qt-right">${esc(b.blanks[+i].opts[b.blanks[+i].a])}</b>`)}</p>
      <small>選項：${b.blanks.map((x, i) => `（${i + 1}）${x.opts.map(esc).join('／')}`).join('　')}</small>`;
  return `<div class="qt-prev">${s}<p class="qt-why">解析：${esc(b.why)}</p>${it.src ? `<p class="qt-src">出處：${esc(it.src)}</p>` : ''}</div>`;
}

function ownForm(box, done) {
  box.innerHTML = `<div class="qt-own">
    <label>知識點<select name="kp">${cache.bank.kps.map((k) => `<option value="${k.id}">${esc(PLACE_NAME[k.place] ?? k.place)}｜${esc(k.name)}</option>`).join('')}</select></label>
    <label>題型<select name="kind"><option value="mc">單選（3 個選項）</option><option value="tf">是非</option></select></label>
    <label>題目<input name="q" maxlength="160" placeholder="例如：八堡圳是從哪一條河引水？"></label>
    <div class="qt-mc"><label>正確答案<input name="o0" maxlength="40"></label><label>錯的選項 1<input name="o1" maxlength="40"></label><label>錯的選項 2<input name="o2" maxlength="40"></label></div>
    <div class="qt-tf" hidden><label class="chip"><input type="radio" name="a" value="1" checked>對</label><label class="chip"><input type="radio" name="a" value="0">不對</label></div>
    <label>解析（為什麼）<input name="why" maxlength="200" placeholder="孩子交卷後會看到"></label>
    <p class="tip">自己出的題只會出現在你的班。選項順序孩子看到時會打亂。</p>
    <div class="row"><button class="btn small go" data-save>加進卷裡</button><button class="ghost small" data-cancel>取消</button></div></div>`;
  const f = box.firstElementChild, v = (n) => f.querySelector(`[name=${n}]`).value.trim();
  f.querySelector('[name=kind]').onchange = (e) => { f.querySelector('.qt-mc').hidden = e.target.value !== 'mc'; f.querySelector('.qt-tf').hidden = e.target.value !== 'tf'; };
  f.querySelector('[data-cancel]').onclick = () => { box.innerHTML = ''; };
  f.querySelector('[data-save]').onclick = async (e) => {
    const kind = v('kind');
    const body = kind === 'tf' ? { q: v('q'), a: f.querySelector('[name=a]:checked').value === '1', why: v('why') }
      : { q: v('q'), opts: [v('o0'), v('o1'), v('o2')], a: 0, why: v('why') };
    e.target.disabled = true;
    try {
      const id = await quiz.addOwn(ctx.active, v('kp'), kind, body);
      cache.bank.items.push({ id, kp: v('kp'), kind, level: 1, body, src: '家長／老師自己出的題目', ver: 1, own: true });
      cache.item.set(id, cache.bank.items.at(-1));
      box.innerHTML = '';
      done(id);
    } catch (err) { e.target.disabled = false; ctx.toast(err.message, true); }
  };
}

// =============================================================================
// 出過的卷
// =============================================================================
async function paintPapers(box) {
  const list = await quiz.papers(ctx.active);
  if (!list.length) {
    box.innerHTML = '<section class="panel"><div class="empty"><img src="img/admin/tick-empty.webp" alt=""><p>還沒出過試煉卷。到「出新卷」挑題寄出。</p></div></section>';
    return;
  }
  box.innerHTML = `<section class="panel"><div class="tablewrap"><table class="qt-papers"><thead><tr><th>卷</th><th>出卷日</th><th>題數</th><th>寫完</th><th>平均</th><th></th></tr></thead><tbody>
    ${list.map((p) => {
      const done = p.kids.filter((k) => k.done), avg = done.length ? Math.round(done.reduce((s, k) => s + k.score, 0) / done.length) : null;
      return `<tr${p.readonly ? ' class="qt-ro"' : ''}><td><b>${esc(p.title)}</b>${p.readonly ? `<span class="tag">學校班「${esc(p.from ?? '')}」${esc(p.by ?? '')}出的・只能看</span>` : ''}<br><small>${p.kids.map((k) => `${esc(k.nickname)}${k.done ? ` ${k.score}` : k.opened ? ' 寫到一半' : ' 還沒開'}`).join('、')}</small></td>
        <td>${date(p.at)}</td><td>${p.n}</td><td>${done.length}/${p.kids.length}</td><td>${avg ?? '—'}</td>
        <td><button class="btn small" data-rep="${p.id}">看報告</button> ${p.readonly ? '' : `<button class="ghost small danger" data-hide="${p.id}" title="還沒寫的孩子就看不到了">收回</button>`}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
  $$('[data-rep]', box).forEach((b) => { b.onclick = () => { sub = 'report:' + b.dataset.rep; paint(); }; });
  $$('[data-hide]', box).forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '確定收回？'; return; }
      await quiz.hide(b.dataset.hide); ctx.toast('收回了'); paint();
    };
  });
}

// =============================================================================
// 分析報告
// =============================================================================
let repKid = null;
async function paintReport(box, paperId) {
  const [r] = await Promise.all([quiz.report(paperId, ctx.active), load(true)]);
  const kids = r.kids;
  if (!kids.some((k) => k.id === repKid)) repKid = (kids.find((k) => k.done) ?? kids[0])?.id;
  const k = kids.find((x) => x.id === repKid);
  const kd = kidsOf().find((x) => x.id === repKid) ?? { played: [], game: [] };
  const played = new Set(kd.played), game = new Map(kd.game.map(([kp, ok]) => [kp, ok]));
  const head = `<section class="panel"><div class="head"><h2>${esc(r.title)}</h2><button class="ghost small" data-back>← 出過的卷</button></div>
    <div class="chips">${kids.map((x) => `<button class="chip${x.id === repKid ? ' on' : ''}" data-kid="${x.id}">${esc(x.nickname)} ${x.done ? x.score + ' 分' : '還沒交'}</button>`).join('')}</div></section>`;
  if (!k?.done) {
    box.innerHTML = head + `<section class="panel"><div class="empty"><img src="img/admin/tick-empty.webp" alt=""><p>${esc(k?.nickname ?? '')} 還沒交卷。交了以後這裡會有每一題的分析。</p></div></section>`;
    return wire();
  }
  const slots = k.slots.map((s) => ({ ...s, place: cache.kp.get(s.kp)?.place, kpName: cache.kp.get(s.kp)?.name, book: cache.kp.get(s.kp)?.book,
                                      read: readSlot(s, game.has(s.kp) ? game.get(s.kp) : null, played.has(cache.kp.get(s.kp)?.place)) }));
  // 哪幾章比較弱
  const byPlace = new Map();
  for (const s of slots) { const p = byPlace.get(s.place) ?? { n: 0, got: 0, wrong: [] }; p.n++; p.got += Number(s.got); if (Number(s.got) < 1) p.wrong.push(s); byPlace.set(s.place, p); }
  const weak = [...byPlace].filter(([, p]) => p.wrong.length).sort((a, b) => a[1].got / a[1].n - b[1].got / b[1].n);
  const ask = slots.filter((s) => s.read.code === 'ask');
  const guess = slots.filter((s) => s.read.fast);
  const total = slots.reduce((t, s) => t + (s.ms || 0), 0);
  box.innerHTML = head + `
  <section class="panel">
    <div class="kpis"><div class="kpi"><b>${k.score}</b><small>分數</small></div><div class="kpi"><b>${slots.filter((s) => Number(s.got) >= 1).length}/${slots.length}</b><small>全對的題</small></div>
      <div class="kpi"><b>${Math.max(1, Math.round(total / 60000))}</b><small>分鐘</small></div><div class="kpi"><b>${k.coins}</b><small>時光幣</small></div></div>
    ${weak.length ? `<h3>比較弱的地方</h3><ul class="qt-weak">${weak.map(([pl, p]) => `<li><b>${esc(PLACE_NAME[pl] ?? pl)}</b>：對 ${Math.round(100 * p.got / p.n)}%（錯 ${p.wrong.length} 題：${[...new Set(p.wrong.map((s) => s.kpName))].map(esc).join('、')}）
        <br><small>課本：${[...new Set(p.wrong.map((s) => s.book))].map(esc).join('、')}${played.has(pl) ? '' : '・還沒玩到這一關'}</small></li>`).join('')}</ul>
      <div class="row"><button class="btn small go" data-rec>✉ 寄信推薦去玩這幾關</button></div>` : '<p class="lead">全部答對，這些知識點離「學會」又近一步。</p>'}
    ${ask.length ? `<h3>可以問問孩子</h3><p class="tip">下面這些題，遊戲裡第一次就答對、卷上卻錯了。可能當時是猜的，也可能忘了。不用責備，問他「你那時候怎麼想的？」</p>
      <ul>${ask.map((s) => `<li>${esc(s.kpName)}：${esc(s.body.q)}</li>`).join('')}</ul>` : ''}
    ${guess.length ? `<p class="tip">有 ${guess.length} 題不到 3 秒就答錯，可能沒看完題目就按了。</p>` : ''}
    <p class="tip">遊戲是輔助，還是要搭配課本。報告裡寫的課本單元，是對應康軒版的章節，其他版本內容相近。</p>
  </section>
  <section class="panel"><h3>每一題</h3><ol class="qz-results qt-res">${slots.map((s, i) => `${resultHtml({ ...s, why: s.body.why, fix_got: s.fix }, i + 1)
      .replace('</li>', `<p class="qt-read r-${s.read.code}"><small>${esc(PLACE_NAME[s.place] ?? '')}｜${esc(s.kpName)}｜課本：${esc(s.book)}${s.ms ? `｜${Math.round(s.ms / 1000)} 秒` : ''}</small><br>${esc(s.read.text)}${s.read.fast ? '（答得很快，可能是猜的）' : ''}</p></li>`)}`).join('')}</ol></section>`;
  wire();
  $('[data-rec]', box)?.addEventListener('click', async (e) => {
    const names = weak.slice(0, 3).map(([pl]) => PLACE_NAME[pl] ?? pl);
    const books = [...new Set(weak.slice(0, 3).flatMap(([, p]) => p.wrong.map((s) => s.book)))].slice(0, 3);
    const body = `${k.nickname}，考官看了你的試煉卷，建議你回去玩：${names.join('、')}。玩的時候注意圖鑑卡和「想一想」，玩完再翻課本：${books.join('、')}。下一張卷會再考這些喔！`;
    e.target.disabled = true;
    try {
      await quiz.recommend(ctx.active, k.id, body, placeZone(weak[0][0]));
      e.target.textContent = '✔ 已寄出';
      ctx.toast(`寄給 ${k.nickname} 了，他打開樂園就會收到。`);
    } catch (err) { e.target.disabled = false; ctx.toast(err.message, true); }
  });
  function wire() {
    $('[data-back]', box).onclick = () => { sub = 'papers'; paint(); };
    $$('[data-kid]', box).forEach((b) => { b.onclick = () => { repKid = b.dataset.kid; paintReport(box, paperId); }; });
  }
}

// =============================================================================
// 學習地圖
// =============================================================================
let mapKid = null;
function paintMap(box) {
  const kids = kidsOf();
  if (!kids.length) { box.innerHTML = '<section class="panel"><p class="lead">這個班還沒有孩子。</p></section>'; return; }
  if (!kids.some((k) => k.id === mapKid)) mapKid = kids[0].id;
  const kid = kids.find((k) => k.id === mapKid), st = statesOf(kid);
  const groups = new Map();
  for (const k of cache.bank.kps) (groups.get(k.place) ?? groups.set(k.place, []).get(k.place)).push(k);
  const count = (s) => Object.values(st).filter((x) => x.state === s).length;
  box.innerHTML = `<section class="panel">
    <div class="chips">${kids.map((k) => `<button class="chip${k.id === mapKid ? ' on' : ''}" data-kid="${k.id}">${esc(k.nickname)}</button>`).join('')}</div>
    <p class="qt-legend">${Object.entries(STATE_NAME).map(([s, t]) => `<span class="qt-kp s-${s}">${t} ${count(s)}</span>`).join('')}</p>
    <p class="tip"><b>學會</b>＝同一個知識點，在不同的兩天、用不同的題目答對（遊戲裡第一次就答對也算一次），而且最近一次是對的。學會的就不再出題。
      覺得孩子其實還不熟，點那一格改回「待加強」，之後的卷會再出。</p>
    ${[...groups].map(([pl, list]) => `<h3>${esc(PLACE_NAME[pl] ?? pl)} <small>${esc(placeGame(pl))}</small></h3>
      <div class="qt-kps">${list.map((k) => { const s = st[k.id]; return `<button class="qt-kp s-${s.state}" data-kp="${k.id}" data-marked="${s.marked ? 1 : 0}"
        title="${esc(k.book)}｜${STATE_NAME[s.state]}${s.game ? `｜遊戲裡第一次${s.game.ok ? '答對' : '答錯'}` : ''}${s.quizTries ? `｜卷上考過 ${s.quizTries} 次` : ''}">${esc(k.name)}${s.marked ? ' 📌' : ''}</button>`; }).join('')}</div>`).join('')}
  </section>`;
  $$('[data-kid]', box).forEach((b) => { b.onclick = () => { mapKid = b.dataset.kid; paintMap(box); }; });
  $$('[data-kp]', box).forEach((b) => {
    b.onclick = async () => {
      const on = b.dataset.marked !== '1';
      try {
        await quiz.mark(ctx.active, mapKid, b.dataset.kp, on);
        kid.marks = { ...(kid.marks ?? {}) };
        if (on) kid.marks[b.dataset.kp] = new Date().toISOString(); else delete kid.marks[b.dataset.kp];
        ctx.toast(on ? '改成待加強了，之後的卷會再出這個知識點' : '取消了');
        paintMap(box);
      } catch (e) { ctx.toast(e.message, true); }
    };
  });
}

// =============================================================================
// 題庫審核（管理員）
// =============================================================================
let bankFilter = 'draft';
let bankPlace = null;     // 題庫審核看哪一章（null＝還沒選，自動挑第一個有題的章）
let bankData = null;
async function paintBank(box) {
  bankData = await quiz.adminBank();
  stale = true;   // 管理員在這裡上架、停用、改題，回到出卷頁就重讀
  const kps = new Map(bankData.kps.map((k) => [k.id, k]));
  const byStatus = bankData.items.filter((i) => bankFilter === 'all' || i.status === bankFilter || (bankFilter === 'flag' && i.flags));
  // 章節照課本順序；每章顯示這個篩選下有幾題
  const places = [...new Set(bankData.kps.map((k) => k.place))];
  const inPlace = (pl) => byStatus.filter((i) => kps.get(i.kp)?.place === pl);
  if (!bankPlace) bankPlace = places.find((pl) => inPlace(pl).length) ?? places[0];
  const items = inPlace(bankPlace);
  const n = (s) => bankData.items.filter((i) => i.status === s).length;
  box.innerHTML = `
  ${bankData.flags.length ? `<section class="panel notice"><h3>孩子回報「這題怪怪的」（${bankData.flags.length}）</h3><ul class="qt-flags">${bankData.flags.map((f) => {
      const it = bankData.items.find((i) => i.id === f.item);
      return `<li><b>${esc(f.item)}</b>（第 ${f.ver} 版）${esc(it?.body.q ?? '')}<br><small>${esc(f.nickname ?? '')}：${esc(f.note || '（沒寫原因）')}</small>
        ${it ? `<details><summary>看題目</summary>${preview(it)}</details>` : ''}
        <div class="row"><button class="ghost small" data-flag="${f.id}" data-wrong="0">題目沒問題</button>
        <button class="ghost small danger" data-flag="${f.id}" data-wrong="1">真的有錯：停用、這一版答錯的全部算對並補幣</button></div></li>`; }).join('')}</ul></section>` : ''}
  <section class="panel">
    <p class="lead">題目先是「待審」，審過「上架」才會被抽到。請確認：答案只有一個說得通、錯的選項真的錯、解析和出處對得上、用字五年級看得懂。</p>
    <div class="chips">${[['draft', `待審 ${n('draft')}`], ['live', `上架 ${n('live')}`], ['off', `停用 ${n('off')}`], ['all', '全部']].map(([k, t]) => `<button class="chip${bankFilter === k ? ' on' : ''}" data-bf="${k}">${t}</button>`).join('')}</div>
    <p class="qt-pl-h"><b>章節</b><small>（括號是這個篩選下的題數，點一章只看那一章）</small></p>
    <div class="chips qt-places">${places.map((pl) => { const c = inPlace(pl).length; return `<button class="chip${pl === bankPlace ? ' on' : ''}${c ? '' : ' none'}" data-bp="${pl}">${esc(PLACE_NAME[pl] ?? pl)}（${c}）</button>`; }).join('')}</div>
    <h3 class="qt-pl-title">${esc(PLACE_NAME[bankPlace] ?? bankPlace)}・${items.length} 題</h3>
    ${bankFilter === 'draft' && items.length ? `<div class="row"><button class="ghost small" id="qt-allok">這一章沒有格式問題的全部上架（${items.filter((i) => !i.check.length).length} 題）</button></div>` : ''}
    <ol class="qt-bank">${items.map((it) => { const k = kps.get(it.kp); return `<li class="qt-row st-${it.status}">
      <div class="qt-row-h"><b>${esc(it.id)}</b><small>${esc(PLACE_NAME[k?.place] ?? '')}｜${esc(k?.name ?? '')}｜${KIND_NAME[it.kind]}｜第 ${it.ver} 版${it.used ? `｜答過 ${it.used} 次、平均 ${it.right}%` : ''}</small>
        <span class="spacer"></span><span class="tag">${{ draft: '待審', live: '上架', off: '停用' }[it.status]}</span></div>
      <p class="qt-q">${esc(it.body.q)}</p>${preview(it)}
      ${it.check.length ? `<p class="warn">格式問題：${it.check.map(esc).join('、')}</p>` : ''}
      <div class="row">${it.status !== 'live' ? `<button class="btn small go" data-rv="${it.id}" data-st="live">✔ 上架</button>` : ''}
        ${it.status !== 'off' ? `<button class="ghost small danger" data-rv="${it.id}" data-st="off">停用</button>` : ''}
        ${it.status !== 'draft' ? `<button class="ghost small" data-rv="${it.id}" data-st="draft">改回待審</button>` : ''}
        <button class="ghost small" data-edit="${it.id}">改題目</button></div>
      <div class="qt-edit" id="ed-${it.id}" hidden></div></li>`; }).join('')}</ol>
    ${items.length ? '' : '<p class="lead">這一章在這個篩選下沒有題目，換一章或換上面的篩選看看。</p>'}
  </section>`;
  $$('[data-bf]', box).forEach((b) => { b.onclick = () => { bankFilter = b.dataset.bf; paintBank(box); }; });
  $$('[data-bp]', box).forEach((b) => { b.onclick = () => { bankPlace = b.dataset.bp; paintBank(box); }; });
  $$('[data-rv]', box).forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await quiz.review(b.dataset.rv, b.dataset.st); ctx.toast('改好了'); paintBank(box); } catch (e) { b.disabled = false; ctx.toast(e.message, true); }
    };
  });
  $('#qt-allok')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    let ok = 0;
    for (const it of items.filter((i) => !i.check.length)) { try { await quiz.review(it.id, 'live'); ok++; } catch { /* 有問題的留著 */ } }
    ctx.toast(`上架了 ${ok} 題`); paintBank(box);
  });
  $$('[data-edit]', box).forEach((b) => {
    b.onclick = () => {
      const it = bankData.items.find((i) => i.id === b.dataset.edit), ed = $('#ed-' + CSS.escape(it.id), box);
      ed.hidden = false;
      openEditor(ed, it, {
        preview,
        note: `改了會變成第 ${it.ver + 1} 版，之前孩子的作答紀錄照舊。`,
        saveLabel: `存檔（維持${{ draft: '待審', live: '上架', off: '停用' }[it.status]}）`,
        onCancel: () => { ed.hidden = true; ed.replaceChildren(); },
        onSave: async (body) => {
          try { await quiz.review(it.id, it.status, body); ctx.toast('存好了'); paintBank(box); } catch (e) { ctx.toast(e.message, true); }
        },
      });
    };
  });
  $$('[data-flag]', box).forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.wrong === '1' && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '確定？這一題會停用，答錯的孩子全部補分'; return; }
      try { const n = await quiz.flagDone(+b.dataset.flag, b.dataset.wrong === '1'); ctx.toast(b.dataset.wrong === '1' ? `停用了，補分給 ${n} 個孩子` : '標成沒問題'); paintBank(box); }
      catch (e) { ctx.toast(e.message, true); }
    };
  });
}
