// 寵物島裝扮、拜訪、今日精選島（資料庫在 supabase/park_isle.sql；規劃 doc「寵物島 2.0 規劃」第 1 期）。
//
// 裝扮：島的風格（主題地面）、島名（三組字各挑一個，不能自己打字），傢俱擺在哪由 js/pet.js 管，這裡負責存到伺服器。
// 拜訪：「今日精選」（全部班級一起選 6 座）、「我們班的島」（一頁 12 座、可以打暱稱或島名找）、「逛逛別的島」（別班隨機 12 座、可換一批）。清單縮圖畫出每座島真的擺法（不會動），點進去才會動。別人的島只能看，
//   每座島每天可以留一個正面圖示，對方下次打開寵物島會看到。
// 資料庫還沒裝（missing）時：裝扮照舊存在這台裝置，拜訪鈕不出現。
import * as auth from './auth.js';
import * as W from './isleworld.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = (a, b) => a + Math.random() * (b - a);

// 島的風格：how＝還沒拿到時寫怎麼拿
export const THEMES = [
  { id: 'spring', name: '春日花園', how: '' },
  { id: 'beach', name: '夕陽海灘', how: '商店 300 幣' },
  { id: 'autumn', name: '楓葉野餐', how: '商店 300 幣' },
  { id: 'snow', name: '雪夜木屋', how: '冬天在商店上架' },
  { id: 'stars', name: '星空露營', how: '完成臺灣島終章' },
  { id: 'candy', name: '糖果樂園', how: '週末活動的獎勵' },
];
// 島名：三組各 20 個，存的是第幾個（park_isle.name）
export const WORDS = [
  ['星空', '微風', '彩虹', '月光', '陽光', '花開', '雪花', '楓葉', '海浪', '糖果', '晨霧', '夕陽', '雲朵', '森林', '螢火', '春天', '夏日', '秋風', '冬眠', '魔法'],
  ['貓咪', '小狗', '倉鼠', '小熊', '小鹿', '石虎', '藍鵲', '小龍', '獨角獸', '蝴蝶', '螞蟻', '穿山甲', '夥伴', '旅人', '勇者', '探險隊', '好朋友', '寶貝', '小精靈', '小英雄'],
  ['樂園', '小島', '秘密基地', '度假村', '遊樂場', '花園', '森林', '營地', '果園', '城堡', '小鎮', '牧場', '海灘', '天堂', '王國', '農場', '學院', '碼頭', '動物園', '小屋'],
];
// 圖示：0 好可愛 1 好厲害 2 好漂亮 3 好好笑 4 好有創意 5 我來過了（圖在 img/pet/react/）
export const REACTS = [['heart', '好可愛'], ['star', '好厲害'], ['flower', '好漂亮'], ['laugh', '好好笑'], ['idea', '好有創意'], ['paw', '我來過了']];
const reactImg = (k) => `<img src="img/pet/react/${REACTS[k][0]}.webp" alt="">`;

export const landSrc = W.landSrc;
const thumb = W.landThumb;
export const nameText = (n) => (n ?? [0, 0, 0]).map((x, i) => WORDS[i][x] ?? WORDS[i][0]).join('・');

let me = null;          // park_isle_me()；null＝資料庫還沒裝或沒登入
let online = false;     // 伺服器存得到
export async function load() {
  try { me = await auth.isle.me(); online = true; } catch { me = null; online = false; }
  return me;
}
export const ready = () => online;
export const saved = () => !!me?.saved;
export const theme = () => me?.theme ?? 'spring';
export const name = () => me?.name ?? [0, 0, 0];
export const themes = () => me?.themes ?? ['spring'];
export const layout = () => me?.layout ?? {};
export const stored = () => me?.stored ?? [];

// 存：先改手上的，再晚一點一起送（拖來拖去不會一直打伺服器）
let saveTimer = 0;
export function save(patch) {
  me = { ...(me ?? {}), ...patch, saved: true };
  if (!online) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    auth.isle.save(theme(), name(), layout(), stored()).catch(() => { /* 存不到下次再存 */ });
  }, 700);
}

// 打開寵物島時：收到的圖示、上了今日精選。回傳要讓寵物說的話（沒有就 null）
const FEAT_KEY = 'park-isle-featured-seen';
export function greet() {
  if (!me) return null;
  const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Taipei' });
  let seenDay = null;
  try { seenDay = localStorage.getItem(FEAT_KEY); } catch { /* 讀不到就再說一次 */ }
  if (me.featured && seenDay !== today) {
    try { localStorage.setItem(FEAT_KEY, today); } catch { /* 存不了就算了 */ }
    return '哇！我們的島上了「今日精選」！大家都會來參觀喔～';
  }
  return null;
}
export function inboxHtml() {
  const list = me?.inbox ?? [];
  if (!list.length) return '';
  return `<div class="isle-inbox" role="status"><h4>有人來拜訪了！</h4><ul>${list.slice(0, 5).map((r) =>
    `<li>${reactImg(r.kind)}<span><b>${esc(r.nickname)}</b> 覺得你的島${REACTS[r.kind][1]}</span></li>`).join('')}</ul>
    ${list.length > 5 ? `<small>還有 ${list.length - 5} 個人也來過</small>` : ''}
    <button type="button" class="ghost small" data-inbox-ok>好開心！</button></div>`;
}
export function inboxSeen() {
  if (!me?.inbox?.length) return;
  me.inbox = [];
  auth.isle.seen().catch(() => {});
}

// ---------- 裝扮面板的上半：島的風格、島名 ----------
// trying：正在試套的風格（還沒拿到的）
export function decorHtml(trying = null) {
  const own = themes();
  const n = name();
  return `<div class="isle-deco">
    <p class="lab">島的名字</p>
    <div class="isle-name-pick">${WORDS.map((w, i) => `<select data-word="${i}" aria-label="島名第 ${i + 1} 段">${w.map((x, k) =>
      `<option value="${k}"${k === n[i] ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`).join('<span>・</span>')}</div>
    <p class="lab">島的風格</p>
    <div class="isle-themes">${THEMES.map((t) => own.includes(t.id)
      ? `<button type="button" class="isle-th${t.id === theme() ? ' on' : ''}" data-theme="${t.id}"><img src="${thumb(t.id)}" alt=""><b>${t.name}</b></button>`
      : `<button type="button" class="isle-th locked${t.id === trying ? ' trying' : ''}" data-try="${t.id}"><img src="${thumb(t.id)}" alt=""><b>${t.name}</b><small>${t.id === trying ? '試套中・再點換回來' : `👀 點我試套・${t.how}`}</small></button>`).join('')}</div>
  </div>`;
}
// onTheme(theme)：換地面圖；onTry(theme)：試套還沒拿到的；onName()：換招牌
export function bindDecor(box, { onTheme, onTry, onName }) {
  box.querySelectorAll('[data-try]').forEach((b) => { b.onclick = () => onTry?.(b.dataset.try); });
  box.querySelectorAll('[data-word]').forEach((s) => {
    s.onchange = () => {
      const n = [...name()];
      n[+s.dataset.word] = +s.value;
      save({ name: n });
      onName?.();
    };
  });
  box.querySelectorAll('[data-theme]').forEach((b) => {
    b.onclick = () => {
      save({ theme: b.dataset.theme });
      box.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === b));
      onTheme?.(b.dataset.theme);
    };
  });
}

// ---------- 拜訪 ----------
// ctx：pet.js 給的 { host（寵物島的外框）, art(species, stage, pose)（寵物圖）}；島怎麼畫看 js/isleworld.js
let ctx = null;
let tab = 'feat';
export function openVisit(c) {
  ctx = c;
  let box = $('.isle-visit', ctx.host);
  if (!box) {
    box = document.createElement('div');
    box.className = 'isle-visit';
    ctx.host.appendChild(box);
  }
  paintList(box);
}
export function closeVisit(host) { $('.isle-visit', host)?.remove(); }

// 「我們班的島」：伺服器一次給一頁 12 座，可以打暱稱或島名找（找得到還沒打開寵物島的同學）
let mq = '', mpage = 0;
let eseed = 0;   // 逛逛別的島：按「換一批」就 +1
async function paintList(box) {
  box.innerHTML = `<div class="iv-panel" role="dialog" aria-label="去拜訪別人的寵物島">
    <button class="x" data-iv-close aria-label="關閉"></button>
    <h3>去拜訪</h3>
    <div class="iv-tabs"><button type="button" data-iv-tab="feat" class="${tab === 'feat' ? 'on' : ''}">⭐ 今日精選</button>
      <button type="button" data-iv-tab="mates" class="${tab === 'mates' ? 'on' : ''}">🏫 我們班</button>
      <button type="button" data-iv-tab="explore" class="${tab === 'explore' ? 'on' : ''}">🧭 去逛逛</button></div>
    ${tab === 'mates' ? `<input type="search" class="iv-find" placeholder="🔍 打同學的暱稱或島名找找看" aria-label="找同學的島" maxlength="20" value="${esc(mq)}">` : ''}
    <div class="iv-list"><p class="tip">讀取中…</p></div></div>`;
  $('[data-iv-close]', box).onclick = () => { unwatchThumbs(); box.remove(); };
  box.querySelectorAll('[data-iv-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.ivTab; paintList(box); }; });
  const find = $('.iv-find', box);
  if (find) {
    let t = 0;
    find.oninput = () => { clearTimeout(t); t = setTimeout(() => { mq = find.value.trim(); mpage = 0; paintRows(box); }, 350); };
  }
  paintRows(box);
}

let rowsSeq = 0;
async function paintRows(box) {
  const list = $('.iv-list', box);
  if (!list) return;
  const seq = ++rowsSeq;
  let rows, page = null;
  try {
    if (tab === 'feat') rows = await auth.isle.featured();
    else if (tab === 'explore') rows = await auth.isle.explore(eseed);
    else { page = await auth.isle.matesPage(mq, mpage); rows = page.rows ?? []; }
  } catch (e) { if (seq === rowsSeq) list.innerHTML = `<p class="tip bad">${esc(e.message)}</p>`; return; }
  if (!box.isConnected || seq !== rowsSeq) return;
  const sum = (a) => (a ?? []).reduce((x, y) => x + y, 0);
  const card = (r) => r.none
    ? `<div class="iv-card none"><span class="th"><img class="empty" src="${thumb('spring')}" alt=""><em>還沒有島</em></span>
        <b>${esc(r.nickname)}</b><small>還沒打開寵物島，等等再來看看</small></div>`
    : `<button type="button" class="iv-card" data-iv-go="${esc(r.id)}">
        <span class="th mini" data-th="${esc(r.id)}">${miniHtml(r)}</span>
        <b>${esc(nameText(r.name))}</b><small>${esc(r.nickname)} 的島・收到 ${sum(r.love)} 個圖示</small></button>`;
  const empty = tab === 'feat' ? '今天還沒有精選島。把自己的島擺上 5 件以上的東西，就有機會被選上！'
    : tab === 'explore' ? '現在還沒有別的島可以逛，晚一點再來看看。'
    : mq ? `找不到「${esc(mq)}」。換個字試試看，或是把字刪掉看全部。`
      : '班上的同學還沒有人打開寵物島。先去「今日精選」逛逛吧！';
  list.innerHTML = rows.length ? `<div class="iv-cards">${rows.map(card).join('')}</div>` : `<p class="tip">${empty}</p>`;
  if (page && page.total > page.size) {
    const pages = Math.ceil(page.total / page.size);
    list.insertAdjacentHTML('beforeend', `<div class="iv-pager">
      <button type="button" class="ghost small" data-pg="-1" ${page.page <= 0 ? 'disabled' : ''}>‹ 上一頁</button>
      <span>第 ${page.page + 1} / ${pages} 頁・共 ${page.total} 座</span>
      <button type="button" class="ghost small" data-pg="1" ${page.page + 1 >= pages ? 'disabled' : ''}>下一頁 ›</button></div>`);
    list.querySelectorAll('[data-pg]').forEach((b) => { b.onclick = () => { mpage = Math.max(0, page.page + +b.dataset.pg); paintRows(box); list.scrollIntoView?.({ block: 'nearest' }); }; });
  } else if (page && page.total) {
    list.insertAdjacentHTML('beforeend', `<p class="note">共 ${page.total} 座${mq ? '' : '，最近有改過的排前面'}。</p>`);
  }
  if (tab === 'feat') list.insertAdjacentHTML('beforeend', '<p class="note">每天早上換一批。島上擺 5 件以上、收到的圖示越多，越有機會上精選。</p>');
  if (tab === 'explore') {
    list.insertAdjacentHTML('beforeend', `<div class="iv-pager"><button type="button" data-more>🔄 換一批</button></div>
      <p class="note">這裡是別班小朋友的島。只看得到暱稱和島名，可以留一個好話圖示。自己的島擺 5 件以上，也會出現在別人這裡喔！</p>`);
    $('[data-more]', list).onclick = () => { eseed++; paintRows(box); };
  }
  list.querySelectorAll('[data-iv-go]').forEach((b) => { b.onclick = () => { unwatchThumbs(); paintVisit(box, b.dataset.ivGo); }; });
  watchThumbs(list);
}

// ---------- 畫一座島（參觀用會動；清單縮圖用不動的） ----------
// 回傳 { html, box }：box＝擺了東西的範圍（島座標 px），縮圖靠它把鏡頭對準有裝潢的地方
function islandParts(v, { still = false } = {}) {
  const { GW, GH, N } = W;
  // 舊的擺法（還沒打開過新的大島）：照舊位置搬過來看
  const items = W.unpack(v.layout) ?? W.migrate(v.layout, Object.keys(v.layout ?? {}), {});
  const occ = W.occupancy(items);
  const free = [];
  for (let c = 0; c < N * N; c++) if (!occ.solid[c]) free.push(c);
  // 縮圖：寵物站在固定的空格（同一座島每次看都一樣），參觀時隨便站
  const pick = (k) => free[still ? (k * 97 + 331) % Math.max(free.length, 1) : Math.floor(Math.random() * free.length)] ?? 0;
  // 枯葉蝶：島主有枯葉蝶、今天還沒找到，就不跟大家一起走，躲在一棵樹或擺設上假裝成葉子（參觀時才有）
  const hide = !still && v.hide && !v.found ? (v.pets ?? []).find((p) => p.species === 'leaf-butterfly') : null;
  const petList = still ? (v.pet ? [{ ...v.pet, name: '' }] : []) : (v.pets ?? []).filter((p) => p !== hide);
  const pets = petList.map((p, k) => { const c = pick(k); return { ...p, ...W.center(c % N, Math.floor(c / N)) }; });
  const z = (y) => Math.round(y * 1000);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const fences = items.filter((o) => ['fence', 'gate'].includes(W.kindOf(o.id))).map((o) => {
    const f = W.fenceEl(o.id, o.i, o.j, W.fenceNb(items, occ, o.i, o.j));
    const c = W.center(o.i, o.j); grow(c.x * GW, c.y * GH);
    return `<span class="fence" style="left:${f.left}px;top:${f.top}px;z-index:${f.z}">${f.html}</span>`;
  }).join('');
  for (const o of items) if (W.kindOf(o.id) === 'path') { const c = W.center(o.i, o.j); grow(c.x * GW, c.y * GH); }
  const props = items.filter((o) => ['furn', 'house', 'bowl', 'tile'].includes(W.kindOf(o.id))).map((o) => {
    const c = W.CAT[o.id], at = W.spot(o.id, o.i, o.j, o.f);
    grow(at.x * GW - c.w / 2, at.y * GH - c.w); grow(at.x * GW + c.w / 2, at.y * GH);
    return `<span class="iv-prop" style="left:${at.x * GW}px;top:${at.y * GH}px;width:${c.w}px;z-index:${z(at.y) - 2};--base:${-c.base * 100}%">
      <img src="img/pet/furniture/${esc(o.id)}.webp" alt=""${o.f ? ' style="transform:scaleX(-1)"' : ''}></span>`;
  }).join('');
  const trees = W.trees(v.theme).map((t) => `<span class="tree" style="left:${t.x * GW}px;top:${t.y * GH}px;width:${t.w}px;z-index:${z(t.y)};--base:${-t.base * 100}%">
    <img src="img/pet/tree/${t.id}.webp" alt=""></span>`).join('');
  const petHtml = pets.map((p, i) => {
    if (still) grow(p.x * GW, p.y * GH);
    return `<span class="iv-pet${still ? ' still' : ''}" style="left:${p.x * GW}px;top:${p.y * GH}px;width:${[0, 84, 98, 112][p.stage] ?? 98}px;z-index:${z(p.y)};--d:${rnd(0, 2).toFixed(2)}s;--k:${i % 2 ? -1 : 1}">
      <img src="${ctx.art(p.species, p.stage, 'idle')}" alt="${esc(p.name)}"></span>`;
  }).join('');
  let leaf = '';
  if (hide) {
    const spots = [...W.trees(v.theme).map((t) => ({ x: t.x, y: t.y })),
      ...items.filter((o) => ['furn', 'house'].includes(W.kindOf(o.id))).map((o) => W.spot(o.id, o.i, o.j, o.f))];
    const at = spots[Math.floor(Math.random() * spots.length)] ?? { x: .5, y: .5 };
    leaf = `<button type="button" class="iv-leaf" data-leaf style="left:${at.x * GW + rnd(-25, 25)}px;top:${at.y * GH - rnd(40, 90)}px;z-index:${z(at.y) + 1}" aria-label="一片葉子？">
      <img src="${ctx.art('leaf-butterfly', hide.stage, 'sit')}" alt=""></button>`;
  }
  const html = `<img class="land" src="${landSrc(v.theme)}" alt="">
    <svg class="floor" viewBox="0 0 ${GW} ${GH}" width="${GW}" height="${GH}" aria-hidden="true">${W.floorSvg(items)}</svg>
    ${trees}${fences}${props}${leaf}${petHtml}`;
  return { html, box: x0 < x1 ? { x0, y0, x1, y1 } : null, hide };
}

// 清單縮圖：整座島太大（卡片裡傢俱會變一粒米），鏡頭對準擺了東西的地方，至少看得到島寬的 22%
function miniHtml(r) {
  const { GW, GH } = W;
  const { html, box } = islandParts(r, { still: true });
  const pad = 70, aspect = 4 / 3, minW = GW * .22;
  let cx = GW / 2, cy = GH * .55, w = minW;
  if (box) {
    cx = (box.x0 + box.x1) / 2; cy = (box.y0 + box.y1) / 2;
    w = Math.max(minW, box.x1 - box.x0 + pad * 2, (box.y1 - box.y0 + pad * 2) * aspect);
  }
  w = Math.min(w, GW);
  const h = w / aspect;
  const x = Math.min(Math.max(cx - w / 2, 0), GW - w), y = Math.min(Math.max(cy - h / 2, 0), Math.max(GH - h, 0));
  return `<span class="iv-ground" data-cw="${w.toFixed(0)}" style="width:${GW}px;height:${GH}px;--x:${(-x).toFixed(0)}px;--y:${(-y).toFixed(0)}px">${html}</span>`;
}

// 縮圖照卡片寬度縮放（卡片寬度會跟著視窗變）
let thumbRO = null;
function fitThumb(th) {
  const g = th.firstElementChild;
  if (!g) return;
  const k = th.clientWidth / +g.dataset.cw;
  g.style.transform = `scale(${k}) translate(var(--x), var(--y))`;
}
function watchThumbs(list) {
  unwatchThumbs();
  const ths = [...list.querySelectorAll('.th.mini')];
  ths.forEach(fitThumb);
  if (typeof ResizeObserver === 'function') {
    thumbRO = new ResizeObserver((es) => es.forEach((e) => fitThumb(e.target)));
    ths.forEach((t) => thumbRO.observe(t));
  }
}
function unwatchThumbs() { thumbRO?.disconnect(); thumbRO = null; }

async function paintVisit(box, id) {
  let v;
  try { v = await auth.isle.view(id); } catch (e) { toast(box, e.message); return; }
  const { GW, GH } = W;
  const parts = islandParts(v), hide = parts.hide;
  box.innerHTML = `<div class="iv-view" role="dialog" aria-label="參觀 ${esc(v.nickname)} 的島">
    <div class="iv-top"><button type="button" class="ghost small" data-iv-back>‹ 回清單</button>
      <p><b>${esc(nameText(v.name))}</b><small>${esc(v.nickname)} 的島</small></p></div>
    <div class="iv-stage"><div class="iv-ground" style="width:${GW}px;height:${GH}px">
      ${parts.html}
    </div></div>
    <div class="iv-react"></div>
    <p class="note iv-note"></p></div>`;
  // 整座島放進畫面；手機直拿太小的話放大一點、可以左右滑
  const fit = () => {
    const st = $('.iv-stage', box);
    if (!st) return;
    const k = Math.max(Math.min(st.clientWidth / GW, st.clientHeight / GH), Math.min(.55, st.clientHeight / GH));
    const g = $('.iv-ground', box);
    g.style.transform = `scale(${k})`;
    g.parentElement.style.setProperty('--w', `${GW * k}px`);
    g.parentElement.style.setProperty('--h', `${GH * k}px`);
  };
  fit();
  addEventListener('resize', fit);
  $('[data-iv-back]', box).onclick = () => { removeEventListener('resize', fit); paintList(box); };
  paintReact(box, v);
  if (hide) {
    $('.iv-note', box).textContent = `${v.nickname} 的枯葉蝶假裝成一片葉子躲在島上，找到牠兩個人都有時光幣！`;
    $('[data-leaf]', box).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await auth.isle.find(v.id);
        b.classList.add('found');
        $('img', b).src = ctx.art('leaf-butterfly', hide.stage, 'cheer');
        toast(box, `找到枯葉蝶了！+${r.coins} 時光幣${r.owner ? `，${v.nickname} 也拿到 ${r.owner} 個` : ''}`);
        dispatchEvent(new Event('park:coins'));
      } catch (err) { toast(box, err.message); }
    };
  } else if (v.hide && v.found) {
    $('.iv-note', box).textContent += ' 今天已經找到這座島的枯葉蝶了，明天牠會躲到別的地方。';
  }
  // 藍鵲的本事：去別人的島玩，每天叼一份小禮物回來
  if (v.gift) {
    auth.isle.gift(v.id).then((g) => {
      if (g && box.isConnected) setTimeout(() => toast(box, `你的臺灣藍鵲從 ${v.nickname} 的島叼回了「${g.name}」，放進背包了！`), 1200);
    }).catch(() => {});
  }
}

let toastTimer = 0;
function toast(box, text) {
  let t = $('.iv-toast', box);
  if (!t) { t = document.createElement('p'); t.className = 'iv-toast'; t.setAttribute('role', 'status'); box.appendChild(t); }
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function paintReact(box, v) {
  const wrap = $('.iv-react', box);
  const mine = v.mine;
  wrap.innerHTML = REACTS.map(([, t], k) => `<button type="button" data-r="${k}" ${mine != null ? 'disabled' : ''} class="${mine === k ? 'mine' : ''}">
    ${reactImg(k)}<b>${t}</b><span>${v.love?.[k] ?? 0}</span></button>`).join('');
  $('.iv-note', box).textContent = mine != null ? '今天已經留過了，明天可以再來。' : '每座島一天可以留一個圖示，只有好話。';
  wrap.querySelectorAll('[data-r]').forEach((b) => {
    b.onclick = async () => {
      const k = +b.dataset.r;
      wrap.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        const r = await auth.isle.react(v.id, k);
        v.love = r.love; v.mine = k;
        toast(box, `跟 ${v.nickname} 說了「${REACTS[k][1]}」！`);
      } catch (e) {
        toast(box, e.message);
      }
      paintReact(box, v);
    };
  });
}
