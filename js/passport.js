// 樂園護照與頭像（P4，資料庫在 supabase/park_passport.sql）。
//
// 護照：每個遊戲一頁，蓋過的章亮起來、沒蓋過的是淡淡的空格加上「怎麼拿到」。
//       剛蓋的新章第一次打開時會「咚」一聲蓋下去，看過就不再播。
// 頭像：就是自己的時空旅人的大頭（js/traveller.js）；蓋章、蓋滿一頁、拿到某類勳章可以解鎖頭像框。
// 勳章（2026-10-08）：章有分類（通關、收集、精通、劇情、彩蛋）和稀有度；島嶼開拓者分過去篇／現在篇、一章一列。
//   點一個拿到的勳章可以掛成「代表勳章」（頭像右下角）、放進名片的 3 格展示櫃；名片別人點得到（openCard）。
// 解鎖條件一律由資料庫判斷，這裡只負責畫出來。
import * as auth from './auth.js';
import { sfx } from './audio.js';
import * as traveller from './traveller.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;

const layer = $('#pass');
let hooks = { me: () => ({ kind: 'guest' }), changed: () => {} };
let book = null;          // park_passport() 的結果
let page = 0;
let era = 'past';         // 有分篇的那一頁現在看哪一篇

export const KIND = { clear: '通關', collect: '收集', master: '精通', story: '劇情', egg: '彩蛋', era: '篇章' };
export const RARE = { bronze: '銅', silver: '銀', gold: '金', rainbow: '彩虹' };
const EMBLEM = { collect: '📖', master: '⭐', story: '🔀', egg: '🥚', era: '⏳' };
const ERAS = [['past', '過去篇'], ['now', '現在篇']];
const keyOf = (facility, code) => `${facility}/${code}`;

// 一枚勳章的圖：稀有度的光圈＋類別的小徽章。m 要有 art、rarity、kind
export function medalHtml(m, cls = '') {
  if (!m) return '';
  const em = EMBLEM[m.kind] ? `<i class="em">${EMBLEM[m.kind]}</i>` : '';
  return `<span class="medal r-${esc(m.rarity || 'bronze')}${cls ? ' ' + cls : ''}"><img src="${esc(m.art)}" alt="">${em}</span>`;
}
// 「全班只有 3 人拿到」
function ownersText(owners, classmates) {
  if (!owners || !classmates || classmates < 2) return '';
  if (owners === 1) return `全班 ${classmates} 人，只有 1 人拿到`;
  if (owners >= classmates) return '全班都拿到了';
  return `全班 ${classmates} 人，只有 ${owners} 人拿到`;
}

export function init(h) { hooks = { ...hooks, ...h }; }

// 頭像＝時空旅人的大頭＋框（2026-10-04 起舊的 24 個頭像不用了）。還沒建旅人的先用滴答。
// look 不給就用自己現在的穿搭。medal：代表勳章（{art, rarity}），掛在右下角。
export function avatarHtml(look = traveller.state()?.look, frame = 'plain', cls = '', medal = null) {
  const img = look ? traveller.headHtml(look) : '<img class="none" src="img/tick/happy.webp" alt="">';
  const pin = medal?.art ? `<img class="av-medal r-${esc(medal.rarity || 'bronze')}" src="${esc(medal.art)}" alt="">` : '';
  return `<span class="av fr-${esc(frame || 'plain')}${cls ? ' ' + cls : ''}">${img}${pin}</span>`;
}

// 每個章蓋下去的角度固定（同一個章每次打開都一樣歪），看起來像真的蓋的
function tilt(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 17) - 8) + 'deg';
}
const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

// short：選頭像格子底下的小字（太長會擠）；點下去的說明用完整的
function needText(r, short = false) {
  if (r.need_stamp) return short ? `拿到「${r.need_stamp_name ?? ''}」` : `拿到「${r.need_stamp_name ?? r.need_stamp}」勳章`;
  if (r.need_kind) return `${r.need_n} 枚${r.need_kind.startsWith('era:') ? '過去篇' : KIND[r.need_kind] ?? ''}勳章`;
  if (r.need_page === '*') return '蓋滿任何一頁';
  if (r.need_page) return short ? '蓋滿一整頁' : `蓋滿「${r.need_page_name ?? r.need_page}」那一頁`;
  return `${r.need_stamps} 個章`;
}

// ---------- 外框 ----------
function show(html) {
  // 已經開著時只換內容，不再跳一次彈出動畫（不然每按一下整個視窗會閃）
  layer.classList.toggle('again', !layer.hidden);
  layer.innerHTML = html;
  layer.hidden = false;
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
export function close() {
  if (layer.hidden) return;
  layer.hidden = true;
  layer.innerHTML = '';
}
layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function problem(e) {
  show(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="樂園護照">
    <button class="x" data-close aria-label="關閉"></button>
    <img class="tick" src="img/tick/${e.missing ? 'thinking' : 'worried'}.webp" alt="">
    <div><h2>${e.missing ? '護照還在印' : '打不開護照'}</h2>
    <p class="lead">${esc(e.missing ? '樂園護照還在準備中，很快就能用了！先去遊戲裡玩，完成的任務之後都會補蓋章。' : e.message)}</p>
    <div class="row"><button class="btn small" data-close>好</button></div></div></div>`);
}

async function load() {
  book = await auth.passport.book();
  return book;
}

// ---------- 護照 ----------
export async function openPassport({ facility } = {}) {
  const w = hooks.me();
  if (w.kind !== 'student') return;
  show('<div class="book loading" role="dialog" aria-modal="true" aria-label="樂園護照"><img src="img/ui/passport.webp" alt=""><p>翻開護照中…</p></div>');
  try { await load(); } catch (e) { problem(e); return; }
  const pages = book.pages ?? [];
  page = Math.max(0, pages.findIndex((p) => p.facility === facility));
  if (!facility) page = Math.max(0, pages.findIndex((p) => p.stamps.some((s) => s.new)));
  render();
  // 新章看過了：動畫只播一次。右上角的「新章」也一起消掉。
  if (pages.some((p) => p.stamps.some((s) => s.new))) {
    auth.passport.seen().then(() => hooks.changed({ unseen: [] })).catch(() => {});
  }
}

function render() {
  const w = hooks.me();
  const pages = book.pages ?? [];
  const p = pages[page];
  const total = book.stamps ?? 0;
  const freshTotal = pages.reduce((n, x) => n + x.stamps.filter((s) => s.new).length, 0);

  // 下一個獎勵：還差最少章數的那一個
  // 頭像改成時空旅人的大頭之後，能解鎖的只剩頭像框
  const frameRewards = book.rewards.filter((r) => r.kind === 'frame');
  const byCount = (r) => !r.need_page && !r.need_kind && !r.need_stamp;
  const locked = frameRewards.filter((r) => !r.unlocked && byCount(r)).sort((a, b) => a.need_stamps - b.need_stamps);
  const next = locked[0];
  // 這次新蓋的章剛好解鎖的（看過護照之前的章數還不夠的那些）
  const fresh = frameRewards.filter((r) => r.unlocked && byCount(r) && r.need_stamps > 0 && r.need_stamps > total - freshTotal);

  const tabs = pages.map((x, i) => {
    const got = x.stamps.filter((s) => s.at).length;
    const n = x.stamps.filter((s) => s.new).length;
    return `<button type="button" class="ptab${i === page ? ' on' : ''}" data-page="${i}">
      <img src="img/badge/${esc(x.zone)}.webp" alt="" onerror="this.src='img/ui/passport.webp'">
      <span><b>${esc(x.name)}</b><small>${got} / ${x.stamps.length} 個章${x.full ? '・蓋滿了' : ''}</small></span>
      ${n ? `<i class="new">新 ${n}</i>` : ''}</button>`;
  }).join('');

  const cell = (s, i) => {
    const style = `style="--r:${tilt(p.facility + s.code)};--i:${i}"`;
    const k = keyOf(p.facility, s.code);
    const cls = `stamp k-${esc(s.kind || 'clear')} r-${esc(s.rarity || 'bronze')}`;
    const em = EMBLEM[s.kind] ? `<i class="em">${EMBLEM[s.kind]}</i>` : '';
    const hidden = s.kind === 'egg' && !s.at;   // 彩蛋：沒拿到之前名字藏起來，只給謎語
    if (s.at) {
      const pin = k === book.featured ? '<img class="pin" src="img/ui/medal-ribbon.webp" alt="代表勳章">' : (book.showcase ?? []).includes(k) ? '<i class="case">展示中</i>' : '';
      return `<button type="button" class="${cls} got${s.new ? ' fresh' : ''}" ${style} data-medal="${esc(k)}">
        <div class="slot"><img src="${esc(s.art)}" alt="">${em}${pin}</div>
        <b>${esc(s.name)}</b><small>${md(s.at)} 拿到</small></button>`;
    }
    if (!s.active) {
      return `<div class="${cls} soon" ${style}><div class="slot"><img src="${esc(s.art)}" alt=""><img class="lock" src="img/ui/lock.webp" alt=""></div>
        <b>${hidden ? '？？？' : esc(s.name)}</b><small>即將開放</small></div>`;
    }
    return `<div class="${cls}" ${style}><div class="slot"><img src="${esc(s.art)}" alt="">${em}</div>
      <b>${hidden ? '？？？' : esc(s.name)}</b><small>${hidden ? '謎語：' : ''}${esc(s.hint)}</small></div>`;
  };

  // 有分篇的頁（島嶼開拓者）：上面切過去篇／現在篇，一章一列（列名＝那一章的通關章）
  const split = p && p.stamps.some((s) => s.era);
  const body = () => {
    if (!split) return `<div class="grid">${p.stamps.map(cell).join('')}</div>`;
    const list = p.stamps.filter((s) => (s.era || 'past') === era);
    const groups = [];
    for (const s of list) {
      const g = s.grp ?? '_';
      let row = groups.find((x) => x.g === g);
      if (!row) groups.push(row = { g, items: [] });
      row.items.push(s);
    }
    const tabs = `<div class="eras">${ERAS.map(([e, name]) => {
      const xs = p.stamps.filter((s) => (s.era || 'past') === e);
      return `<button type="button" class="${e === era ? 'on' : ''}" data-era="${e}">${name}<small>${xs.filter((s) => s.at).length} / ${xs.length}</small></button>`;
    }).join('')}</div>`;
    const soon = list.length && list.every((s) => !s.active) ? '<p class="tip build">🚧 現在篇還在施工中，先把過去篇的勳章蒐集起來吧！</p>' : '';
    let n = 0;
    return tabs + soon + groups.map(({ g, items }) => {
      const head = g === '_' ? '篇章大獎' : (p.stamps.find((s) => s.code === g)?.name ?? g);
      const got = items.filter((s) => s.at).length;
      return `<section class="mrow"><h4>${esc(head)}<small>${got} / ${items.length}</small></h4>
        <div class="mgrid">${items.map((s) => cell(s, n++)).join('')}</div></section>`;
    }).join('');
  };

  const got = p ? p.stamps.filter((s) => s.at).length : 0;
  const fm = featuredMedal();
  show(`<div class="book" role="dialog" aria-modal="true" aria-label="樂園護照">
    <button class="x" data-close aria-label="關閉護照"></button>
    <section class="leaf left">
      <div class="owner">${avatarHtml(undefined, book.frame, 'big', fm)}
        <div><small>時空冒險樂園・護照</small><b>${esc(w.nickname)}</b>
        <span>已經拿到 <em>${total}</em> 個章</span></div></div>
      <div class="feat">${fm ? `${medalHtml(fm, 'sm')}<p><small>代表勳章</small><b>${esc(fm.name)}</b></p>`
        : '<p class="tip">點一個拿到的勳章，就能掛成<b>代表勳章</b>，別人點你的時候看得到。</p>'}</div>
      <div class="row"><button type="button" class="btn small" data-card>我的名片</button><button type="button" class="ghost small" data-wear>換裝間</button><button type="button" class="ghost small" data-avatar>頭像框</button></div>
      <nav class="ptabs" aria-label="選一個遊戲的那一頁">${tabs || '<p class="tip">還沒有遊戲提供護照章。</p>'}</nav>
      ${fresh.length ? `<div class="unlock"><img src="img/fx/sparkle.webp" alt=""><p><b>新解鎖！</b>${fresh.map((r) => esc(r.name)).join('、')}頭像框，按「頭像框」換上去吧。</p></div>`
        : next ? `<div class="next">${avatarHtml(undefined, next.code, 'mini')}
          <p>再蓋 <b>${next.need_stamps - total}</b> 個章，就能解鎖頭像框「${esc(next.name)}」</p></div>` : ''}
    </section>
    <section class="leaf right">
      ${p ? `<h2>${esc(p.name)}</h2>
      <p class="lead">這一頁拿到 ${got} / ${p.stamps.length} 個章${split ? '・點拿到的勳章可以掛出來' : ''}</p>
      ${body()}
      ${p.full ? '<div class="full">這一頁蓋滿了！</div>' : ''}` : '<p class="lead">護照還是空的，去遊戲裡完成任務就會蓋章！</p>'}
    </section></div>`);

  layer.querySelectorAll('[data-era]').forEach((b) => { b.onclick = () => { era = b.dataset.era; clearFresh(); render(); }; });
  layer.querySelectorAll('[data-medal]').forEach((b) => { b.onclick = () => openMedal(b.dataset.medal); });
  $('[data-card]', layer).onclick = () => openCard(w.id, { back: true });
  layer.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { page = +b.dataset.page; clearFresh(); render(); }; });
  $('[data-avatar]', layer).onclick = () => openAvatar({ back: true });
  $('[data-wear]', layer).onclick = () => { close(); traveller.open(); };
  if (!reduceMotion) layer.querySelectorAll('.stamp.fresh').forEach((el, i) => sparkle(el, i));
}

// 護照裡找一枚勳章：'設施/章' → 章（加上 facility）
function findMedal(k) {
  for (const pg of book?.pages ?? []) for (const s of pg.stamps) if (keyOf(pg.facility, s.code) === k) return { ...s, facility: pg.facility, page: pg };
  return null;
}
function featuredMedal() {
  const m = book?.featured && findMedal(book.featured);
  return m?.at ? m : null;
}

// 點一枚拿到的勳章：大圖、類別、稀有度、全班幾個人有；可以掛成代表勳章、放進展示櫃
function openMedal(k) {
  const m = findMedal(k);
  if (!m?.at) return;
  const showcase = [...(book.showcase ?? [])];
  const inCase = showcase.includes(k);
  const isFeat = book.featured === k;
  const grpName = m.grp ? m.page.stamps.find((s) => s.code === m.grp)?.name : '';
  const pop = document.createElement('div');
  pop.className = 'mpop-cover';
  pop.innerHTML = `<div class="mpop" role="dialog" aria-label="${esc(m.name)}">
    ${medalHtml(m, 'xl')}
    <h3>${esc(m.name)}</h3>
    <p class="tags"><span class="tag r-${esc(m.rarity)}">${RARE[m.rarity] ?? ''}</span><span class="tag">${KIND[m.kind] ?? ''}勳章</span>${grpName && m.kind !== 'clear' ? `<span class="tag">${esc(grpName)}</span>` : ''}</p>
    <p class="how">${esc(m.hint)}</p>
    <p class="when">${md(m.at)} 拿到${ownersText(m.owners, book.classmates) ? `・<b>${ownersText(m.owners, book.classmates)}</b>` : ''}</p>
    <div class="row">
      <button type="button" class="btn small" data-feat ${isFeat ? 'disabled' : ''}>${isFeat ? '已經是代表勳章' : '掛成代表勳章'}</button>
      <button type="button" class="ghost small" data-case>${inCase ? '從展示櫃拿下' : '放進展示櫃'}</button>
    </div>
    <p class="msg" hidden></p>
    <button type="button" class="ghost small" data-shut>關掉</button></div>`;
  layer.appendChild(pop);
  const shut = () => pop.remove();
  pop.addEventListener('click', (e) => { if (e.target === pop) shut(); });
  $('[data-shut]', pop).onclick = shut;
  const msg = $('.msg', pop);
  const save = async (featured, list) => {
    try {
      const r = await auth.passport.setMedals(featured, list);
      book.featured = r.featured;
      book.showcase = r.showcase ?? [];
      const fm = featuredMedal();
      hooks.changed({ featured: fm ? { art: fm.art, rarity: fm.rarity, name: fm.name, kind: fm.kind } : null });
      sfx('SE-20');
      shut();
      clearFresh();
      render();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  };
  $('[data-feat]', pop).onclick = () => save(k, null);
  $('[data-case]', pop).onclick = () => {
    if (inCase) return save(null, showcase.filter((x) => x !== k));
    if (showcase.length >= 3) { msg.textContent = '展示櫃只有 3 格，先點一個放在裡面的勳章拿下來。'; msg.hidden = false; return; }
    save(null, [...showcase, k]);
  };
}

// ---------- 名片：別人點我的角色看到的（之後朋友清單、排行榜也叫這個） ----------
// back：從護照來的，關掉回護照
export async function openCard(student, { back = false } = {}) {
  if (!student) return;
  show('<div class="book loading" role="dialog" aria-modal="true"><img src="img/ui/passport.webp" alt=""><p>拿出名片…</p></div>');
  let c;
  try { c = await auth.passport.card(student); } catch (e) { problem(e); return; }
  const mine = student === hooks.me().id;
  const f = c.featured;
  const slots = [0, 1, 2].map((i) => {
    const m = c.showcase?.[i];
    return m ? `<div class="case-slot got">${medalHtml(m, 'md')}<b>${esc(m.name)}</b><small>${RARE[m.rarity] ?? ''}・${KIND[m.kind] ?? ''}</small></div>`
      : `<div class="case-slot"><span class="empty">？</span><small>${mine ? '在護照點勳章放進來' : '空的'}</small></div>`;
  }).join('');
  show(`<div class="sheet namecard" role="dialog" aria-modal="true" aria-label="${esc(c.nickname)}的名片">
    <button class="x" data-close aria-label="關閉"></button>
    <div class="who fr-${esc(c.frame || 'plain')}">${c.look ? traveller.dollHtml(c.look) : '<img class="none" src="img/tick/happy.webp" alt="">'}</div>
    <div class="info">
      <small>時空旅人</small><h2>${esc(c.nickname)}</h2>
      <p class="lead">護照裡有 <b>${c.stamps}</b> 個章</p>
      ${f ? `<div class="feature r-${esc(f.rarity)}"><img class="fribbon" src="img/ui/medal-ribbon.webp" alt="">${medalHtml(f, 'xl')}
        <div><small>代表勳章</small><b>${esc(f.name)}</b><span>${RARE[f.rarity] ?? ''}・${KIND[f.kind] ?? ''}勳章${f.grp_name && f.kind !== 'clear' ? '・' + esc(f.grp_name) : ''}</span>
        ${ownersText(f.owners, f.classmates) ? `<em>${ownersText(f.owners, f.classmates)}</em>` : ''}</div></div>`
        : `<p class="tip">${mine ? '還沒掛代表勳章：打開護照，點一個拿到的勳章就能掛上來。' : '還沒掛代表勳章。'}</p>`}
      <h3>展示櫃</h3>
      <div class="cases">${slots}</div>
      ${back ? '<div class="row end"><button type="button" class="ghost small" data-back>回護照</button></div>' : ''}
    </div></div>`);
  const b = $('[data-back]', layer);
  if (b) b.onclick = () => render();
}

// 只有第一次打開時播「新章」動畫；翻到別頁再翻回來就不再播
function clearFresh() {
  for (const x of book.pages) for (const s of x.stamps) s.new = false;
}

function sparkle(el, i) {
  setTimeout(() => {
    const img = document.createElement('img');
    img.src = 'img/fx/star-burst.webp';
    img.className = 'stamp-burst';
    img.alt = '';
    el.appendChild(img);
    img.addEventListener('animationend', () => img.remove());
  }, 450 + i * 350);
}

// ---------- 頭像框 ----------
// 頭像就是自己的時空旅人（大頭），在換裝間換樣子；這裡只挑框。back：從護照來的，存好回護照
export async function openAvatar({ back = false } = {}) {
  const w = hooks.me();
  if (w.kind !== 'student') return;
  if (!book || !back) {
    show('<div class="book loading" role="dialog" aria-modal="true"><img src="img/ui/passport.webp" alt=""><p>拿出頭像框…</p></div>');
    try { await load(); } catch (e) { problem(e); return; }
  }
  let fr = book.frame ?? 'plain';
  const frames = book.rewards.filter((r) => r.kind === 'frame');
  const nameOf = (code) => frames.find((r) => r.code === code)?.name ?? '';

  const paint = () => {
    show(`<div class="sheet picker" role="dialog" aria-modal="true" aria-label="選頭像框">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="pv">${avatarHtml(undefined, fr, 'huge')}<b>${esc(nameOf(fr))}</b>
        <p>頭像就是你的時空旅人，在換裝間換樣子。蓋越多章、拿到越多種勳章，可以選的頭像框越多。</p>
        <button type="button" class="ghost" data-wear>去換裝間</button></div>
      <div class="choose">
        <h3>頭像框</h3>
        <div class="frs">${frames.map((r) => `<button type="button" class="pick${r.unlocked ? '' : ' locked'}${fr === r.code ? ' on' : ''}" data-fr="${esc(r.code)}" aria-label="${esc(r.name)}${r.unlocked ? '' : '（還沒解鎖）'}">
          ${avatarHtml(undefined, r.code)}<span class="nm">${esc(r.name)}</span>${r.unlocked ? '' : `<span class="need"><img src="img/ui/lock.webp" alt="">${esc(needText(r, true))}</span>`}</button>`).join('')}</div>
        <p class="msg" hidden></p>
        <div class="row end">${back ? '<button type="button" class="ghost" data-back>回護照</button>' : ''}
          <button type="button" class="btn go" data-save>換上去</button></div>
      </div></div>`);

    const msg = $('.msg', layer);
    const say = (t, ok = false) => { msg.textContent = t; msg.className = 'msg' + (ok ? ' ok' : ''); msg.hidden = !t; };
    const lockedSay = (r) => say(`「${r.name}」還沒解鎖，要${r.need_page || r.need_kind || r.need_stamp ? '' : '總共蓋到 '}${needText(r)}才能用。`);
    layer.querySelectorAll('[data-fr]').forEach((b) => {
      b.onclick = () => {
        const r = frames.find((x) => x.code === b.dataset.fr);
        if (!r.unlocked) return lockedSay(r);
        fr = r.code; paint();
      };
    });
    $('[data-wear]', layer).onclick = () => { close(); traveller.open(); };
    const backBtn = $('[data-back]', layer);
    if (backBtn) backBtn.onclick = () => render();
    $('[data-save]', layer).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const p = await auth.passport.setAvatar(null, fr);
        book.frame = p.frame;
        hooks.changed({ frame: p.frame });
        sfx('SE-20');
        if (back) render(); else close();
      } catch (err) {
        say(err.message);
        b.disabled = false;
      }
    };
  };
  paint();
}
