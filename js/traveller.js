// 時空旅人換裝（資料庫在 supabase/park_traveller.sql）。
//
// 每個學生有一個時空旅人：同一個身體，七個位置各疊一張圖（img/traveller/<code>.webp，448×600，全部對齊）。
//   疊的順序：背後 → 身體 → 臉 → 褲子和鞋 → 上衣 → 頭髮 → 頭飾 → 手持。
//   臉型、髮型人人都有；衣服配件是起始套裝送的那 4 件，其他的等樂園商店開張用時光幣買。
//   沒有的衣服可以「試穿」看看，但存不起來（存的時候資料庫會再檢查一次）。
// 建角色：第一次進地圖時挑臉型、髮型和一套起始套裝。
// 資料庫還沒裝這份 SQL 時，先存在這台裝置（localStorage），讓測試站照樣能玩。
import * as auth from './auth.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SLOTS = [
  { id: 'face',   name: '臉型',     none: '中性' },
  { id: 'hair',   name: '髮型' },
  { id: 'hat',    name: '頭飾',     none: '不戴' },
  { id: 'top',    name: '上衣',     none: '灰色 T 恤' },
  { id: 'bottom', name: '褲子和鞋', none: '短褲光腳' },
  { id: 'hand',   name: '手持',     none: '空手' },
  { id: 'back',   name: '背後',     none: '不背' },
];
const ORDER = ['back', 'base', 'face', 'bottom', 'top', 'hair', 'hat', 'hand'];

// 跟 park_traveller.sql 的初始資料一樣（資料庫負責檢查，這裡負責名字和畫圖）
export const SETS = [
  { code: 'street', name: '韓系街頭', blurb: '漁夫帽、牛仔外套配帽T、工裝寬褲老爹鞋，再拿一台底片相機。' },
  { code: 'tech',   name: '科技機能', blurb: 'AR 眼鏡、會發光的機能外套和鞋子，還有一台跟著你飛的小無人機。' },
  { code: 'tw',     name: '台灣潮',   blurb: '黑熊棒球帽、客家花布襯衫、寬短褲配拖鞋，手上一杯黑糖珍奶。' },
];
const I = (code, slot, name, set = null, price = null) => ({ code, slot, name, set, free: !set, price });
export const ITEMS = [
  I('face-girl', 'face', '女孩'), I('face-boy', 'face', '男孩'),
  I('hair-crop', 'hair', '紋理短髮'), I('hair-wolf', 'hair', '狼尾'), I('hair-wavy', 'hair', '長捲髮'), I('hair-pony', 'hair', '高馬尾'),
  I('hat-bucket', 'hat', '燈芯絨漁夫帽', 'street', 60), I('hat-visor', 'hat', 'AR 眼鏡', 'tech', 60), I('hat-cap', 'hat', '黑熊棒球帽', 'tw', 60),
  I('top-street', 'top', '牛仔外套配帽T', 'street', 100), I('top-tech', 'top', '發光機能外套', 'tech', 100), I('top-floral', 'top', '客家花布襯衫', 'tw', 100),
  I('bottom-wide', 'bottom', '工裝寬褲老爹鞋', 'street', 80), I('bottom-tech', 'bottom', '機能褲發光鞋', 'tech', 80), I('bottom-shorts', 'bottom', '寬短褲配拖鞋', 'tw', 80),
  I('hand-camera', 'hand', '底片相機', 'street', 50), I('hand-tea', 'hand', '黑糖珍奶', 'tw', 50),
  I('back-drone', 'back', '小無人機', 'tech', 120),
];
const item = (code) => ITEMS.find((x) => x.code === code);
const HIDES_HAIR = new Set();   // 戴上會把頭髮整個蓋住的頭飾（之後的太空頭盔之類）
const EMPTY = Object.fromEntries(SLOTS.map((s) => [s.id, null]));
const setLook = (setCode) => Object.fromEntries(ITEMS.filter((x) => x.set === setCode).map((x) => [x.slot, x.code]));

const layer = $('#wardrobe');
let hooks = { me: () => ({ kind: 'guest' }), changed: () => {} };
let st = null;        // { created, look, starter_set, owned:[...] }；不是學生是 null
let local = false;    // 資料庫還沒裝：存在這台裝置

export function init(h) { hooks = { ...hooks, ...h }; }
export function state() { return st; }
export function needsCreate() { return hooks.me().kind === 'student' && st && !st.created; }

// ---------- 讀寫（資料庫或這台裝置） ----------
const localKey = () => 'park-traveller:' + ((who ?? hooks.me()).id ?? '');
function readLocal() {
  try { return JSON.parse(localStorage.getItem(localKey())) ?? null; } catch { return null; }
}
function writeLocal(v) { try { localStorage.setItem(localKey(), JSON.stringify(v)); } catch {} }

// w：還沒登記成 hooks.me() 之前（account.js 讀「我是誰」的時候）就要讀，可以直接帶進來
let who = null;
export async function load(w = hooks.me()) {
  who = w;
  if (w.kind !== 'student') { st = null; return st; }
  try {
    st = await auth.traveller.me();
    local = false;
  } catch (e) {
    if (!e.missing) { st = null; return st; }
    local = true;
    st = readLocal() ?? { created: false, look: null, starter_set: null, owned: [] };
  }
  return st;
}
const owns = (code) => !code || item(code)?.free || (st?.owned ?? []).includes(code);

async function create(face, hair, set) {
  if (!local) return auth.traveller.create(face, hair, set);
  const owned = ITEMS.filter((x) => x.set === set).map((x) => x.code);
  const v = { created: true, starter_set: set, owned, look: { ...EMPTY, ...setLook(set), face, hair } };
  writeLocal(v);
  return v;
}
async function save(look) {
  if (!local) return auth.traveller.save(look);
  const bad = Object.values(look).find((c) => !owns(c));
  if (bad) throw new Error(`「${item(bad).name}」還不是你的，商店開張後就能買`);
  const v = { ...st, look: { ...EMPTY, ...look } };
  writeLocal(v);
  return v;
}

// ---------- 畫出一個旅人 ----------
export function dollHtml(look, cls = '') {
  const L = { ...EMPTY, ...(look ?? {}) };
  const imgs = ORDER.map((s) => {
    const code = s === 'base' ? 'base' : L[s];
    if (!code) return '';
    if (s === 'hair' && HIDES_HAIR.has(L.hat)) return '';
    return `<img src="img/traveller/${esc(code)}.webp" alt="" draggable="false">`;
  }).join('');
  return `<span class="doll${cls ? ' ' + cls : ''}">${imgs}</span>`;
}
// 大頭（頭像）：同一組疊圖，只露出頭到肩膀那一塊（框在 css 的 .av .head）
export function headHtml(look) {
  return dollHtml(look, 'head');
}
const thumb = (code) => `<img src="img/traveller/thumb/${esc(code)}.webp" alt="" draggable="false">`;

// ---------- 外框 ----------
function show(html) {
  layer.classList.toggle('again', !layer.hidden);
  layer.innerHTML = html;
  layer.hidden = false;
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
export function close() {
  if (!layer || layer.hidden) return;
  layer.hidden = true;
  layer.innerHTML = '';
}
layer?.addEventListener('click', (e) => { if (e.target === layer) close(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function busy(text) {
  show(`<div class="ward loading" role="dialog" aria-modal="true"><img src="img/tick/happy.webp" alt=""><p>${esc(text)}</p></div>`);
}

// 打開：還沒建角色就先建，建好了是換裝間
export async function open() {
  if (hooks.me().kind !== 'student') return;
  busy('打開衣櫃中…');
  try { await load(); } catch {}
  if (!st) {
    show(`<div class="ward small" role="dialog" aria-modal="true" aria-label="換裝間">
      <button class="x" data-close aria-label="關閉"></button>
      <img src="img/tick/worried.webp" alt=""><div><h2>打不開衣櫃</h2><p class="lead">連不上樂園，等一下再試一次。</p>
      <div class="row"><button type="button" class="btn small" data-close>好</button></div></div></div>`);
    return;
  }
  if (!st.created) openCreator(); else openWardrobe();
}

// ---------- 建角色 ----------
export function openCreator() {
  const w = hooks.me();
  const d = { face: null, hair: 'hair-crop', set: 'street' };
  const lookOf = (set = d.set) => ({ ...EMPTY, ...setLook(set), face: d.face, hair: d.hair });

  const paint = () => {
    const faces = [[null, '中性', 'base'], ...ITEMS.filter((x) => x.slot === 'face').map((x) => [x.code, x.name, x.code])];
    const hairs = ITEMS.filter((x) => x.slot === 'hair');
    show(`<div class="ward first" role="dialog" aria-modal="true" aria-label="建立你的時空旅人">
      <button class="x" data-close aria-label="等一下再選"></button>
      <div class="stage">${dollHtml(lookOf(), 'big')}<b class="who">${esc(w.nickname ?? '')}</b></div>
      <div class="pane">
        <h2>你的時空旅人</h2>
        <p class="lead">這是你在樂園裡的樣子。挑臉型和髮型，再選一套起始套裝，整套送你！之後隨時可以到換裝間換。</p>
        <h3>臉型</h3>
        <div class="opts">${faces.map(([c, n, t]) => `<button type="button" class="opt${d.face === c ? ' on' : ''}" data-face="${c ?? ''}" aria-pressed="${d.face === c}">${thumb(t)}<span>${esc(n)}</span></button>`).join('')}</div>
        <h3>髮型</h3>
        <div class="opts">${hairs.map((x) => `<button type="button" class="opt${d.hair === x.code ? ' on' : ''}" data-hair="${x.code}" aria-pressed="${d.hair === x.code}">${thumb(x.code)}<span>${esc(x.name)}</span></button>`).join('')}</div>
        <h3>起始套裝<small>選一套，整套 4 件都是你的</small></h3>
        <div class="sets">${SETS.map((s) => `<button type="button" class="set${d.set === s.code ? ' on' : ''}" data-set="${s.code}" aria-pressed="${d.set === s.code}">
          ${dollHtml(lookOf(s.code), 'mini')}<span><b>${esc(s.name)}</b><small>${esc(s.blurb)}</small></span></button>`).join('')}</div>
        <p class="msg" hidden></p>
        <div class="row end"><button type="button" class="btn go" data-go>就是這樣，出發！</button></div>
      </div></div>`);
    layer.querySelectorAll('[data-face]').forEach((b) => { b.onclick = () => { d.face = b.dataset.face || null; paint(); }; });
    layer.querySelectorAll('[data-hair]').forEach((b) => { b.onclick = () => { d.hair = b.dataset.hair; paint(); }; });
    layer.querySelectorAll('[data-set]').forEach((b) => { b.onclick = () => { d.set = b.dataset.set; paint(); }; });
    $('[data-go]', layer).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        st = await create(d.face, d.hair, d.set);
        sfx('SE-20');
        hooks.changed(st);
        openWardrobe({ welcome: true });
      } catch (err) {
        const m = $('.msg', layer); m.textContent = err.message; m.hidden = false;
        b.disabled = false;
      }
    };
  };
  paint();
}

// ---------- 換裝間 ----------
export function openWardrobe({ welcome = false } = {}) {
  const w = hooks.me();
  let d = { ...EMPTY, ...st.look };
  let tab = 'top';
  let note = welcome ? ['ok', '你的時空旅人誕生了！這裡是換裝間，想換什麼都可以來。'] : null;

  const trying = () => SLOTS.filter((s) => !owns(d[s.id])).map((s) => item(d[s.id]));
  const dirty = () => SLOTS.some((s) => (d[s.id] ?? null) !== (st.look?.[s.id] ?? null));

  const optHtml = (code, name, t) => {
    const it = code && item(code);
    const mine = owns(code);
    const on = (d[tab] ?? null) === code;
    return `<button type="button" class="opt${on ? ' on' : ''}${mine ? '' : ' locked'}" data-pick="${code ?? ''}" aria-pressed="${on}"
      aria-label="${esc(name)}${mine ? '' : '（還沒有，可以試穿）'}">
      ${t ? thumb(t) : '<span class="none">無</span>'}<span>${esc(name)}</span>
      ${mine ? '' : `<i class="tag"><img src="img/ui/lock.webp" alt="">${it?.price ? `商店 ${it.price}` : '商店'}</i>`}</button>`;
  };

  const paint = () => {
    const slot = SLOTS.find((s) => s.id === tab);
    const list = ITEMS.filter((x) => x.slot === tab);
    const opts = [
      ...(slot.none ? [optHtml(null, slot.none, tab === 'face' ? 'base' : null)] : []),
      ...list.map((x) => optHtml(x.code, x.name, x.code)),
    ].join('');
    const tri = trying();
    const msg = tri.length
      ? ['try', `試穿中：${tri.map((x) => `「${x.name}」`).join('')}還不是你的，樂園商店開張後可以用時光幣買。`]
      : note;
    show(`<div class="ward" role="dialog" aria-modal="true" aria-label="換裝間">
      <button class="x" data-close aria-label="關閉換裝間"></button>
      <div class="stage">${dollHtml(d, 'big')}<b class="who">${esc(w.nickname ?? '')}</b></div>
      <div class="pane">
        <h2>換裝間</h2>
        <div class="sets row">${SETS.map((s) => `<button type="button" class="chipbtn" data-set="${s.code}">穿整套「${esc(s.name)}」</button>`).join('')}</div>
        <nav class="tabs" role="tablist" aria-label="換哪個位置">${SLOTS.map((s) => `<button type="button" role="tab" class="tab${s.id === tab ? ' on' : ''}" aria-selected="${s.id === tab}" data-tab="${s.id}">${esc(s.name)}</button>`).join('')}</nav>
        <div class="opts">${opts}</div>
        ${msg ? `<p class="note ${msg[0]}">${esc(msg[1])}</p>` : ''}
        ${local ? '<p class="tip">（測試中：換好的樣子先存在這台裝置）</p>' : ''}
        <div class="row end">
          ${tri.length ? '<button type="button" class="ghost" data-untry>脫掉試穿的</button>' : ''}
          <button type="button" class="ghost" data-close>${dirty() ? '不換了' : '關閉'}</button>
          <button type="button" class="btn go" data-save ${dirty() && !tri.length ? '' : 'disabled'}>換好了</button>
        </div>
      </div></div>`);

    layer.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; note = null; paint(); $(`[data-tab="${tab}"]`, layer)?.focus(); }; });
    layer.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { d[tab] = b.dataset.pick || null; note = null; paint(); $(`[data-pick="${b.dataset.pick}"]`, layer)?.focus(); };
    });
    layer.querySelectorAll('[data-set]').forEach((b) => {
      b.onclick = () => { d = { ...d, hat: null, top: null, bottom: null, hand: null, back: null, ...setLook(b.dataset.set) }; note = null; paint(); };
    });
    const un = $('[data-untry]', layer);
    if (un) un.onclick = () => { for (const s of SLOTS) if (!owns(d[s.id])) d[s.id] = st.look?.[s.id] ?? null; paint(); };
    $('[data-save]', layer).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        st = await save(d);
        d = { ...EMPTY, ...st.look };
        sfx('SE-20');
        hooks.changed(st);
        note = ['ok', '換好了！'];
        paint();
      } catch (err) {
        note = ['bad', err.message];
        paint();
      }
    };
  };
  paint();
}
