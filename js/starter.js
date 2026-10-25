// 新手冒險手冊（資料庫在 supabase/park_starter.sql）。
//
// 註冊 14 天內、還沒翻完的學生才有：底部功能列的「每日任務」換成「新手手冊」，
// 功能列上面多一條「下一步」，地圖上要去的島（或功能列的按鈕）會跳箭頭。
// 一次只給一步；做沒做到是伺服器看紀錄判斷的，做完當下發時光幣，一頁做完再送那頁的禮物。
// 一頁一天：今天這頁做完了，就預告明天的禮物。
import * as auth from './auth.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const btn = $('#guide-btn');
const strip = $('#starter');
const layer = $('#shop');          // 跟錢包、商店共用一個對話框層
let hooks = { me: () => ({ kind: 'guest' }), toast: () => {}, go: () => {}, isle: () => null };
let st = null;                      // park_starter_me 的結果；沒有手冊是 null

export function init(h) { hooks = { ...hooks, ...h }; }
export const active = () => !!st && !st.finished;

// 現在要做的那一步（null＝今天這頁做完了，等明天）
function current() {
  if (!st || st.finished || st.locked) return null;
  return st.steps.find((s) => !s.done && !s.skipped) ?? null;
}
// 滴答進地圖時要說的話
export function line() {
  if (!active()) return null;
  const s = current();
  if (!s) return `今天的新手手冊完成了！明天再來，會送你「${st.gift.name}」喔。`;
  return st.page === 1 && st.steps.every((x) => !x.done) ? `歡迎來到樂園！先照著新手手冊走：${s.name}。` : `新手手冊的下一步：${s.name}！`;
}

export async function load(w = hooks.me()) {
  const before = st;
  st = null;
  if (w.kind === 'student') {
    try { st = await auth.starter.me(); } catch { st = null; }
  }
  paint();
  if (st?.fresh?.length) announce(st.fresh, !before);
  return st;
}

// 做完步驟、拿到禮物：一則一則跳通知；拿到禮物另外開一張卡片
function announce(list, first) {
  const gift = list.find((x) => x.gift);
  const steps = list.filter((x) => !x.gift);
  if (steps.length) hooks.toast(`📖 ${steps.length > 1 ? `新手手冊完成 ${steps.length} 步！` : steps[0].text}`);
  sfx('SE-20');
  if (gift) setTimeout(() => openBook(gift.text), first ? 1400 : 600);
  dispatchEvent(new CustomEvent('park:coins', { detail: { balance: st?.balance } }));
}

// 在樂園裡做的步驟（換裝、寵物、商店）做完馬上重讀
let rechecking = null;
function recheck() {
  if (!st) return;
  rechecking ??= auth.starter.me()
    .then((s) => { st = s; paint(); if (s?.fresh?.length) announce(s.fresh, false); })
    .catch(() => {})
    .finally(() => { rechecking = null; });
}
['park:traveller', 'park:pet-care', 'park:shop'].forEach((ev) => addEventListener(ev, () => setTimeout(recheck, 400)));

// 功能列的按鈕、地圖上的島：要去的地方跳箭頭
const DOCK = { wear: '#wear-btn', pet: '#pet-btn', shop: '#shop-btn', passport: '#pass-btn' };
function paintTarget() {
  document.querySelectorAll('.starter-target').forEach((el) => el.classList.remove('starter-target'));
  const s = current();
  if (!s?.go) return;
  const el = DOCK[s.go] ? $(DOCK[s.go]) : hooks.isle(s.go);
  el?.classList.add('starter-target');
}

function paint() {
  const on = active();
  document.body.dataset.starter = on ? 'on' : '';
  btn.hidden = !on;
  strip.hidden = !on;
  if (!on) { paintTarget(); return; }
  const s = current();
  const done = st.steps.filter((x) => x.done || x.skipped).length;
  $('.badge', btn).textContent = `${st.page}/${st.pages}`;
  btn.dataset.state = s ? 'left' : 'all';
  btn.setAttribute('aria-label', `新手手冊：第 ${st.page} 頁`);
  strip.innerHTML = s
    ? `<button type="button" class="book" data-book aria-label="打開新手手冊"><img src="img/ui/task.webp" alt=""><small>第 ${st.page} 頁 ${done}/${st.steps.length}</small></button>
       <p><b>${esc(s.name)}</b><span>${esc(s.hint)}</span></p>
       ${s.go ? '<button type="button" class="btn small go" data-go>去！</button>' : ''}`
    : `<button type="button" class="book" data-book aria-label="打開新手手冊"><img src="img/ui/task.webp" alt=""><small>第 ${st.page} 頁</small></button>
       <p><b>今天的手冊完成了！</b><span>明天再來翻下一頁，送你「${esc(st.gift.name)}」。</span></p>`;
  strip.dataset.state = s ? 'go' : 'wait';
  $('[data-book]', strip).onclick = () => openBook();
  const g = $('[data-go]', strip);
  if (g) g.onclick = () => go(s);
  paintTarget();
}
function go(s) {
  close();
  if (s.go === 'shop') hooks.go('shop');
  else hooks.go(s.go);
}
btn.addEventListener('click', () => openBook());

// ---------- 手冊本身：這頁的步驟、這頁的禮物、七頁的進度 ----------
function close() { layer.hidden = true; layer.innerHTML = ''; }
export function openBook(msg = null) {
  if (!st) return;
  if (st.finished) {
    show(`<div class="wallet starter-book" role="dialog" aria-modal="true" aria-label="新手手冊">
      <button class="x" data-close aria-label="關閉"></button>
      <h2>新手手冊</h2>
      ${msg ? `<p class="note ok gift">🎁 ${esc(msg)}</p>` : ''}
      <p class="lead">七頁全部完成，你從樂園新手畢業了！之後每天的任務在功能列的「每日任務」。</p>
      <div class="row end"><button type="button" class="btn go" data-close>好！</button></div></div>`);
    return;
  }
  const s = current();
  const rows = st.steps.map((x) => `<li class="${x.done ? 'got' : x.skipped ? 'skip' : x === s ? 'now' : ''}">
      <span class="tk">${x.done ? '✓' : ''}</span><b>${esc(x.name)}</b>
      ${x.done ? '<small>完成</small>' : x.skipped ? '<small>你的班還沒開這座島，先跳過</small>'
        : x === s && x.go ? '<button type="button" class="btn small go" data-go>去</button>' : '<small>還沒做</small>'}</li>`).join('');
  const dots = Array.from({ length: st.pages }, (_, i) => `<i class="${i + 1 < st.page ? 'on' : i + 1 === st.page ? 'cur' : ''}">${i + 1}</i>`).join('');
  show(`<div class="wallet starter-book" role="dialog" aria-modal="true" aria-label="新手手冊">
    <button class="x" data-close aria-label="關閉"></button>
    <h2>新手手冊</h2>
    <p class="pages">${dots}</p>
    ${msg ? `<p class="note ok gift">🎁 ${esc(msg)}</p>` : ''}
    <h3>${esc(st.title)}${st.locked ? '' : ` <small>做完這頁送你</small>`}</h3>
    ${st.locked
      ? `<p class="lead">今天的手冊完成了！明天再來翻開這一頁，送你：</p>`
      : `<ul class="daily">${rows}</ul><p class="tip">每一步做完會自動拿到時光幣，不用按領。</p>`}
    <div class="present"><img src="${esc(st.gift.art)}" alt=""><b>${esc(st.gift.name)}</b></div>
    <p class="tip">一天開一頁，七頁都做完就從樂園新手畢業。</p>
    <div class="row end"><button type="button" class="ghost" data-close>關閉</button></div>
  </div>`);
  const g = $('[data-go]', layer);
  if (g) g.onclick = () => go(s);
}
function show(html) {
  layer.innerHTML = html;
  layer.hidden = false;
  layer.onclick = (e) => { if (e.target === layer) close(); };
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
