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
  const s = on ? current() : null;
  btn.hidden = !on;
  // 今天這頁做完了就把「下一步」條收起來（2026-10-25 Chuck：一直停在下面）；功能列的手冊鈕還在
  strip.hidden = !s;
  if (!on) { paintTarget(); return; }
  const done = st.steps.filter((x) => x.done || x.skipped).length;
  $('.badge', btn).textContent = `${st.page}/${st.pages}`;
  btn.dataset.state = s ? 'left' : 'all';
  btn.setAttribute('aria-label', `新手手冊：第 ${st.page} 頁`);
  strip.innerHTML = s
    ? `<button type="button" class="gbook" data-book aria-label="打開新手手冊"><img src="img/ui/task.webp" alt=""><small>第 ${st.page} 頁 ${done}/${st.steps.length}</small></button>
       <p><b>${esc(s.name)}</b><span>${esc(s.hint)}</span></p>
       ${s.go ? '<button type="button" class="btn small go" data-go>去！</button>' : ''}`
    : `<button type="button" class="gbook" data-book aria-label="打開新手手冊"><img src="img/ui/task.webp" alt=""><small>第 ${st.page} 頁</small></button>
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
  // 七天的禮物一排列出來：做完的打勾、今天這頁發亮、還沒到的先看得到禮物（大目標）
  const gifts = st.gifts ?? Array.from({ length: st.pages }, (_, i) => ({ page: i + 1, done: i + 1 < st.page }));
  // 點哪一天就在下面寫那天送什麼（2026-10-26 Chuck：只看圖示看不出是什麼）
  const dots = gifts.map((g) => `<button type="button" data-day="${g.page}" class="${g.done ? 'on' : g.page === st.page ? 'cur' : ''}${g.page === st.page ? ' sel' : ''}" aria-label="第 ${g.page} 天的禮物：${esc(g.name ?? '')}">
      ${g.art ? `<img src="${esc(g.art)}" alt="">` : ''}<span>${g.done ? '✓' : `第 ${g.page} 天`}</span></button>`).join('');
  const peekText = (g) => !g?.name ? '' : `第 ${g.page} 天：<b>${esc(g.name)}</b>　${g.done ? '已經拿到了' : g.page === st.page ? (st.locked ? '明天翻開這頁' : '做完今天這頁就送') : (g.page - (st.day ?? 1) > 0 ? `再過 ${g.page - (st.day ?? 1)} 天就能翻到` : '先把前面幾頁做完')}`;
  show(`<div class="wallet starter-book" role="dialog" aria-modal="true" aria-label="新手手冊">
    <button class="x" data-close aria-label="關閉"></button>
    <h2>新手手冊</h2>
    <p class="pages gifts">${dots}</p>
    ${st.gifts ? `<p class="peek">${peekText(gifts.find((g) => g.page === st.page))}</p>` : ''}
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
  layer.querySelectorAll('[data-day]').forEach((b) => {
    b.onclick = () => {
      layer.querySelectorAll('[data-day]').forEach((x) => x.classList.toggle('sel', x === b));
      const peek = $('.peek', layer);
      if (peek) peek.innerHTML = peekText(gifts.find((x) => x.page === +b.dataset.day));
      sfx('SE-01');
    };
  });
}
function show(html) {
  layer.innerHTML = html;
  layer.hidden = false;
  layer.onclick = (e) => { if (e.target === layer) close(); };
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
