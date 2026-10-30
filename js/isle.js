// 寵物島裝扮、拜訪、今日精選島（資料庫在 supabase/park_isle.sql；規劃 doc「寵物島 2.0 規劃」第 1 期）。
//
// 裝扮：島的風格（主題地面）、島名（三組字各挑一個，不能自己打字），傢俱擺在哪由 js/pet.js 管，這裡負責存到伺服器。
// 拜訪：「今日精選」（全部班級一起選 6 座）和「我們班的島」（試玩班不列）。別人的島只能看，
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
export function decorHtml() {
  const own = themes();
  const n = name();
  return `<div class="isle-deco">
    <p class="lab">島的名字</p>
    <div class="isle-name-pick">${WORDS.map((w, i) => `<select data-word="${i}" aria-label="島名第 ${i + 1} 段">${w.map((x, k) =>
      `<option value="${k}"${k === n[i] ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`).join('<span>・</span>')}</div>
    <p class="lab">島的風格</p>
    <div class="isle-themes">${THEMES.map((t) => own.includes(t.id)
      ? `<button type="button" class="isle-th${t.id === theme() ? ' on' : ''}" data-theme="${t.id}"><img src="${thumb(t.id)}" alt=""><b>${t.name}</b></button>`
      : `<span class="isle-th locked"><img src="${thumb(t.id)}" alt=""><b>${t.name}</b><small>🔒 ${t.how}</small></span>`).join('')}</div>
  </div>`;
}
// onTheme(theme)：換地面圖；onName()：換招牌
export function bindDecor(box, { onTheme, onName }) {
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

async function paintList(box) {
  box.innerHTML = `<div class="iv-panel" role="dialog" aria-label="去拜訪別人的寵物島">
    <button class="x" data-iv-close aria-label="關閉"></button>
    <h3>去拜訪</h3>
    <div class="iv-tabs"><button type="button" data-iv-tab="feat" class="${tab === 'feat' ? 'on' : ''}">⭐ 今日精選</button>
      <button type="button" data-iv-tab="mates" class="${tab === 'mates' ? 'on' : ''}">🏫 我們班的島</button></div>
    <div class="iv-list"><p class="tip">讀取中…</p></div></div>`;
  $('[data-iv-close]', box).onclick = () => box.remove();
  box.querySelectorAll('[data-iv-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.ivTab; paintList(box); }; });
  const list = $('.iv-list', box);
  let rows;
  try { rows = tab === 'feat' ? await auth.isle.featured() : await auth.isle.mates(); } catch (e) { list.innerHTML = `<p class="tip bad">${esc(e.message)}</p>`; return; }
  if (!box.isConnected) return;
  const sum = (a) => (a ?? []).reduce((x, y) => x + y, 0);
  list.innerHTML = rows.length ? `<div class="iv-cards">${rows.map((r) => `<button type="button" class="iv-card" data-iv-go="${esc(r.id)}">
      <span class="th"><img src="${thumb(r.theme)}" alt="">${r.pet ? `<img class="pet" src="${ctx.art(r.pet.species, r.pet.stage, 'idle')}" alt="">` : ''}</span>
      <b>${esc(nameText(r.name))}</b><small>${esc(r.nickname)} 的島・收到 ${sum(r.love)} 個圖示</small></button>`).join('')}</div>`
    : `<p class="tip">${tab === 'feat' ? '今天還沒有精選島。把自己的島擺上 5 件以上的東西，就有機會被選上！'
      : '班上還沒有其他同學。試玩班的同學互相不認識，所以只看得到「今日精選」。'}</p>`;
  if (tab === 'feat') list.insertAdjacentHTML('beforeend', '<p class="note">每天早上換一批。島上擺 5 件以上、收到的圖示越多，越有機會上精選。</p>');
  list.querySelectorAll('[data-iv-go]').forEach((b) => { b.onclick = () => paintVisit(box, b.dataset.ivGo); });
}

async function paintVisit(box, id) {
  let v;
  try { v = await auth.isle.view(id); } catch (e) { toast(box, e.message); return; }
  const { GW, GH, N } = W;
  // 舊的擺法（還沒打開過新的大島）：照舊位置搬過來看
  const items = W.unpack(v.layout) ?? W.migrate(v.layout, Object.keys(v.layout ?? {}), {});
  const occ = W.occupancy(items);
  const free = [];
  for (let c = 0; c < N * N; c++) if (!occ.solid[c]) free.push(c);
  const pets = (v.pets ?? []).map((p) => { const c = free[Math.floor(Math.random() * free.length)] ?? 0; return { ...p, ...W.center(c % N, Math.floor(c / N)) }; });
  const z = (y) => Math.round(y * 1000);
  const fences = items.filter((o) => ['fence', 'gate'].includes(W.kindOf(o.id))).map((o) => {
    const f = W.fenceEl(o.id, o.i, o.j, W.fenceNb(items, occ, o.i, o.j));
    return `<span class="fence" style="left:${f.left}px;top:${f.top}px;z-index:${f.z}">${f.html}</span>`;
  }).join('');
  const props = items.filter((o) => ['furn', 'house', 'bowl', 'tile'].includes(W.kindOf(o.id))).map((o) => {
    const c = W.CAT[o.id], at = W.spot(o.id, o.i, o.j, o.f);
    return `<span class="iv-prop" style="left:${at.x * GW}px;top:${at.y * GH}px;width:${c.w}px;z-index:${z(at.y) - 2};--base:${-c.base * 100}%">
      <img src="img/pet/furniture/${esc(o.id)}.webp" alt=""${o.f ? ' style="transform:scaleX(-1)"' : ''}></span>`;
  }).join('');
  const trees = W.trees(v.theme).map((t) => `<span class="tree" style="left:${t.x * GW}px;top:${t.y * GH}px;width:${t.w}px;z-index:${z(t.y)};--base:${-t.base * 100}%">
    <img src="img/pet/tree/${t.id}.webp" alt=""></span>`).join('');
  box.innerHTML = `<div class="iv-view" role="dialog" aria-label="參觀 ${esc(v.nickname)} 的島">
    <div class="iv-top"><button type="button" class="ghost small" data-iv-back>‹ 回清單</button>
      <p><b>${esc(nameText(v.name))}</b><small>${esc(v.nickname)} 的島</small></p></div>
    <div class="iv-stage"><div class="iv-ground" style="width:${GW}px;height:${GH}px">
      <img class="land" src="${landSrc(v.theme)}" alt="">
      <svg class="floor" viewBox="0 0 ${GW} ${GH}" width="${GW}" height="${GH}" aria-hidden="true">${W.floorSvg(items)}</svg>
      ${trees}${fences}${props}
      ${pets.map((p, i) => `<span class="iv-pet" style="left:${p.x * GW}px;top:${p.y * GH}px;width:${[0, 84, 98, 112][p.stage] ?? 98}px;z-index:${z(p.y)};--d:${rnd(0, 2).toFixed(2)}s;--k:${i % 2 ? -1 : 1}">
        <img src="${ctx.art(p.species, p.stage, 'idle')}" alt="${esc(p.name)}"></span>`).join('')}
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
