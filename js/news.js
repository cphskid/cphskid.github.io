// 樂園公告（2026-10-24）：一則公告寫一次，發的人勾要用哪幾種方式出現（資料庫在 supabase/park_news.sql）。
//
//   📌 board    村莊布告欄：樂園村莊的介紹卡裡，有新傳單時村莊亮紅點
//   🚩 flag     島嶼布條＋紅點：掛在選的島上，孩子從那座島「開始冒險」一次就收
//   🎈 balloon  熱氣球布條：天上飄過一次，點了看內容
//   ✉️ letter   信差來信：信鴿飛到名牌下面的信箱，點了才打開；勾「重要」的第一次自動打開一次
//
// 另外兩種不用發、自動來的：
//   - changelog.json 某一版有 news（一句話）→ 布告欄多一張「修理站」傳單（21 天內）
//   - 問題回報有新回覆 → 信箱裡多一封「你的回報有消息囉」（js/feedback.js 的 notify:'courier'）
//
// 只在樂園地圖出現，進島、進遊戲都不會跳。看過的記在帳號上（沒登入的記在這台裝置）。
import * as auth from './auth.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const LOCAL_KEY = 'park.news.seen';     // 沒登入的人、changelog 傳單：看過哪些（{ id: ['board'] }）
const CL_DAYS = 21;                      // changelog 的 news 在布告欄留幾天

let hooks = { me: () => ({ kind: 'guest' }), isle: () => null, mapLayer: () => null, mapWidth: 2200, go: () => {}, scene: () => 'title' };
let list = [];          // park_news_mine 的結果＋changelog 傳單
let fbUnread = 0;       // 問題回報有幾則新回覆（信箱裡變成一封信）
let flown = false;      // 這次進地圖信鴿飛過了沒
let autoOpened = false; // 「重要」的信這頁只自動開一次
const mailBtn = $('#mail-btn');

export function init(h) {
  hooks = { ...hooks, ...h };
  mailBtn?.addEventListener('click', () => openMail());
  addEventListener('park:feedback-fixed', (e) => { fbUnread = e.detail?.n ?? 0; paint(); });
}

// ---------- 看過了沒 ----------
function local() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; } }
function saveLocal(m) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(m)); } catch { /* 無痕模式：下次照樣是新的 */ } }
const seen = (n, part) => n.seen.includes(part);
function markSeen(items, part) {
  const todo = items.filter((n) => !seen(n, part));
  if (!todo.length) return;
  const m = local();
  for (const n of todo) {
    n.seen = [...n.seen, part];
    // changelog 傳單、沒登入的人：記在這台裝置；學生：記在帳號上
    if (n.local || hooks.me().kind !== 'student') m[n.id] = n.seen;
    else auth.db?.rpc('park_news_seen', { p_id: n.id, p_parts: [part] }).then(() => {}, () => {});
  }
  saveLocal(m);
  paint();
}

// ---------- 讀資料 ----------
async function changelogNews() {
  try {
    const r = await fetch('data/changelog.json', { cache: 'no-cache' });
    const today = new Date();
    return ((await r.json()).versions ?? [])
      .filter((v) => v.news && v.audience !== 'staff' && (today - new Date(v.date)) / 864e5 <= CL_DAYS)
      .map((v) => ({ id: `cl:${v.version}`, local: true, kinds: ['board'], title: v.title, body: v.news, banner: v.title,
                     link: 'repair', zones: [], starts_on: v.date, active: true, seen: [] }));
  } catch { return []; }
}

export async function load() {
  let rows = [];
  if (auth.db) {
    try {
      const { data, error } = await auth.db.rpc('park_news_mine');
      if (!error && Array.isArray(data)) rows = data;
    } catch { /* 還沒裝 SQL：只剩 changelog 傳單 */ }
  }
  const m = local();
  const guest = hooks.me().kind !== 'student';
  list = [...rows, ...await changelogNews()].map((n) => ({ ...n, seen: (n.local || guest) ? (m[n.id] ?? []) : (n.seen ?? []) }));
  list.sort((a, b) => String(b.starts_on).localeCompare(String(a.starts_on)));
  flown = false;
  paint();
  if (hooks.scene() === 'map') onMap();
}

const active = (kind) => list.filter((n) => n.active && n.kinds.includes(kind));
const letters = () => list.filter((n) => n.kinds.includes('letter'));
const unreadLetters = () => letters().filter((n) => n.active && !seen(n, 'letter'));
export const boardUnread = () => active('board').filter((n) => !seen(n, 'board')).length;

// ---------- 地圖上的東西：村莊紅點、島嶼布條、信箱 ----------
function paint() {
  // 村莊：布告欄有沒看過的傳單
  const village = hooks.isle('village');
  village?.querySelector('.news-dot')?.remove();
  if (village && boardUnread()) village.querySelector('.lift')?.insertAdjacentHTML('beforeend', '<span class="news-dot" aria-hidden="true">NEW</span>');
  // 島嶼布條：一座島只掛最新的一條
  document.querySelectorAll('.news-flag').forEach((el) => el.remove());
  const flags = new Map();
  for (const n of active('flag')) if (!seen(n, 'flag')) for (const z of n.zones) if (!flags.has(z)) flags.set(z, n);
  for (const [z, n] of flags) {
    hooks.isle(z)?.querySelector('.lift')?.insertAdjacentHTML('beforeend',
      `<div class="news-flag" aria-hidden="true"><img src="img/news/flag.webp" alt="">${bannerText(n)}<b class="news-dot">NEW</b></div>`);
  }
  // 信箱（學生才有）
  if (mailBtn) {
    const kid = hooks.me().kind === 'student';
    mailBtn.hidden = !kid;
    const n = unreadLetters().length + (fbUnread ? 1 : 0);
    const dot = $('.dot', mailBtn);
    dot.hidden = !n;
    dot.textContent = n;
    mailBtn.setAttribute('aria-label', n ? `信箱：有 ${n} 封新信` : '信箱');
  }
}

// 布條上的字：寫在圖上空白那一塊，字多就縮小（--n＝字數）
function bannerText(n) {
  const t = n.banner || n.title;
  return `<span style="--n:${Math.max(4, [...t].length)}">${esc(t)}</span>`;
}

// 島的介紹卡最上面：這座島掛著的布條寫了什麼
export function cardHtml(zone) {
  const n = active('flag').find((x) => x.zones.includes(zone));
  if (!n) return '';
  return `<div class="news-card-flag">🚩 <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>`;
}
// 從那座島「開始冒險」：布條收起來
export function entered(zone) {
  markSeen(active('flag').filter((n) => n.zones.includes(zone)), 'flag');
}

// ---------- 進到地圖：熱氣球飄過、信鴿送信 ----------
export function onMap() {
  if (hooks.scene() !== 'map') return;
  launchBalloon();
  if (flown) return;
  const fresh = unreadLetters();
  if (!fresh.length && !fbUnread) return;
  flown = true;
  setTimeout(() => {
    flyPigeon();
    const imp = fresh.find((n) => n.important);
    if (imp && !autoOpened) { autoOpened = true; setTimeout(() => openLetter(imp), reduceMotion ? 300 : 1800); }
  }, reduceMotion ? 0 : 1600);
}

function flyPigeon() {
  if (!mailBtn || mailBtn.hidden) return;
  mailBtn.classList.remove('got'); void mailBtn.offsetWidth;
  if (reduceMotion) { mailBtn.classList.add('got'); return; }
  const r = mailBtn.getBoundingClientRect();
  const bird = document.createElement('img');
  bird.className = 'news-pigeon';
  bird.src = 'img/news/pigeon.webp';
  bird.alt = '';
  bird.style.cssText = `--tx:${r.left + r.width / 2 - innerWidth - 60}px;--ty:${r.top + r.height / 2 - 40}px`;
  document.body.appendChild(bird);
  sfx('SE-19');
  bird.addEventListener('animationend', () => { bird.remove(); mailBtn.classList.add('got'); });
}

let balloonEl = null;
function launchBalloon() {
  if (balloonEl || reduceMotion) return;
  const n = active('balloon').find((x) => !seen(x, 'balloon'));
  const layer = hooks.mapLayer();
  if (!n || !layer) return;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'news-balloon';
  el.setAttribute('aria-label', `熱氣球：${n.title}，點一下看看`);
  el.style.setProperty('--span', hooks.mapWidth + 700 + 'px');
  el.innerHTML = `<div class="news-tow"><img src="img/news/tow.webp" alt="">${bannerText(n)}</div><img class="news-ball" src="img/news/balloon.webp" alt="">`;
  const done = () => { el.remove(); balloonEl = null; markSeen([n], 'balloon'); };
  el.addEventListener('click', (e) => { e.stopPropagation(); done(); openNews(n); });
  el.addEventListener('animationend', done);
  layer.appendChild(el);
  balloonEl = el;
}

// ---------- 視窗 ----------
const LINK = {
  'shop-month': '去商店看看', repair: '去時光修理站', wear: '去換裝間', pet: '去寵物島', quiz: '去時光試煉島',
};
const linkLabel = (l) => LINK[l] ?? (String(l).startsWith('zone:') ? '去那座島看看' : '去看看');
function show(html, onClose) {
  const veil = document.createElement('div');
  veil.className = 'nw-veil';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.innerHTML = html;
  const close = () => { veil.remove(); removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  veil.addEventListener('click', (e) => {
    if (e.target === veil || e.target.closest('[data-close]')) return close();
    const go = e.target.closest('[data-go]');
    if (go) { close(); hooks.go(go.dataset.go); }
  });
  document.body.appendChild(veil);
  sfx('SE-03');
  (veil.querySelector('[data-go]') ?? veil.querySelector('[data-close]'))?.focus();
  return { veil, close };
}
const goBtn = (n) => (n.link ? `<button type="button" class="nw-btn go" data-go="${esc(n.link)}">${esc(linkLabel(n.link))}</button>` : '');
const date = (d) => String(d ?? '').slice(5).replace('-', '/');

// 熱氣球點開：有信就開信，沒有就開傳單
function openNews(n) { return n.kinds.includes('letter') ? openLetter(n) : openFlyer(n); }

function openFlyer(n) {
  markSeen([n], 'board');
  show(`<div class="nw-flyer"><span class="nw-pin"></span><h2>${esc(n.title)}</h2>
    ${n.body ? `<p>${esc(n.body).replace(/\n/g, '<br>')}</p>` : ''}
    <small>${n.ends_on && !n.local ? `到 ${date(n.ends_on)}` : date(n.starts_on)}</small>
    <div class="nw-row">${goBtn(n)}<button type="button" class="nw-btn" data-close>好</button></div></div>`);
}

// 📌 布告欄（樂園村莊的介紹卡裡按「看布告欄」）
export function openBoard() {
  const now = active('board');
  const old = list.filter((n) => !n.active && n.kinds.includes('board')).slice(0, 6);
  const flyer = (n) => `<button type="button" class="nw-note${seen(n, 'board') ? '' : ' fresh'}" data-id="${esc(n.id)}"><i class="nw-pin"></i><b>${esc(n.title)}</b><span>${esc(n.body).slice(0, 40)}${n.body.length > 40 ? '…' : ''}</span></button>`;
  const { veil } = show(`<div class="nw-board">
    <img class="nw-board-art" src="img/news/board.webp" alt="">
    <h2>樂園布告欄</h2>
    <div class="nw-notes">${now.length ? now.map(flyer).join('') : '<p class="nw-empty">布告欄現在空空的，有新消息會貼在這裡！</p>'}</div>
    ${old.length ? `<details class="nw-old"><summary>以前的公告</summary><div class="nw-notes">${old.map(flyer).join('')}</div></details>` : ''}
    <button type="button" class="nw-btn" data-close>關閉</button></div>`);
  veil.addEventListener('click', (e) => {
    const b = e.target.closest('.nw-note');
    if (!b) return;
    const n = list.find((x) => String(x.id) === b.dataset.id);
    if (n) { veil.remove(); openFlyer(n); }
  });
  markSeen(now, 'board');
}

// 樂園村莊介紹卡裡的布告欄那一格
export function villageHtml() {
  const k = boardUnread();
  return `<div class="fac news-fac"><h3>樂園布告欄${k ? ` <i class="news-new">${k} 張新的</i>` : ''}</h3>
    <div class="row"><img class="news-board-mini" src="img/news/board.webp" alt=""><p>新活動、新功能、修好了什麼，都貼在這裡。</p></div>
    <div class="row"><button type="button" class="btn go" data-open-board>看布告欄</button></div></div>`;
}

// ✉️ 信
function openLetter(n, after) {
  markSeen([n], 'letter');
  const more = unreadLetters().filter((x) => x !== n);
  const { veil, close } = show(`<div class="nw-letter"><span class="nw-seal"></span>
    <h2>${esc(n.title)}</h2>
    ${n.body ? `<p>${esc(n.body).replace(/\n/g, '<br>')}</p>` : ''}
    ${n.sign ? `<p class="nw-sign">— ${esc(n.sign)}</p>` : ''}
    <div class="nw-row">${goBtn(n)}${more.length ? `<button type="button" class="nw-btn" data-next>下一封（還有 ${more.length}）</button>` : ''}<button type="button" class="nw-btn" data-close>收進信箱</button></div></div>`, after);
  veil.querySelector('[data-next]')?.addEventListener('click', () => { veil.remove(); openLetter(more[0], after); });
  return close;
}

// 信箱：有新信就直接打開最新的那封；都看過了就列出以前的信
export function openMail() {
  const fresh = unreadLetters();
  if (fresh.length) return openLetter(fresh[0]);
  if (fbUnread) return window.ParkFeedback?.showFixed?.();
  const all = letters();
  const { veil } = show(`<div class="nw-mail"><img class="nw-mail-art" src="img/news/mailbox.webp" alt="">
    <h2>我的信箱</h2>
    <div class="nw-list">${all.length ? all.map((n) => `<button type="button" class="nw-item" data-id="${esc(n.id)}"><b>${esc(n.title)}</b><small>${esc(n.sign ?? '')} ${date(n.starts_on)}</small></button>`).join('')
      : '<p class="nw-empty">還沒有信。信鴿送信來的時候，會停在這個信箱上喔！</p>'}</div>
    <div class="nw-row">${window.ParkFeedback ? '<button type="button" class="nw-btn" data-fb>💬 我的問題回報</button>' : ''}<button type="button" class="nw-btn" data-close>關閉</button></div></div>`);
  veil.addEventListener('click', (e) => {
    const b = e.target.closest('.nw-item');
    if (b) { const n = list.find((x) => String(x.id) === b.dataset.id); if (n) { veil.remove(); openLetter(n); } }
    if (e.target.closest('[data-fb]')) { veil.remove(); window.ParkFeedback?.open('mine'); }
  });
}

// ---------- 樣式 ----------
const CSS = `
.news-dot{position:absolute;right:10%;top:6%;z-index:3;padding:4px 10px;border-radius:999px;background:#e2553f;color:#fff;border:3px solid #fff;font:900 15px/1 var(--f-body,system-ui);box-shadow:0 3px 0 #8a2a1a;animation:newsPing 1s ease-in-out infinite alternate;pointer-events:none}
@keyframes newsPing{from{transform:scale(1) rotate(-6deg)}to{transform:scale(1.15) rotate(6deg)}}
.news-flag{position:absolute;left:6%;top:-4%;z-index:3;width:270px;pointer-events:none;transform-origin:8% 90%;animation:newsWave 3s ease-in-out infinite}
.news-flag>img{display:block;width:100%;filter:drop-shadow(0 5px 4px rgba(0,0,0,.25))}
.news-flag>span,.news-tow>span{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;white-space:nowrap;font:900 calc(min(36px, 280px / var(--n))) / 1 var(--f-body,system-ui);color:#a5321c;letter-spacing:.02em}
.news-flag>span{left:11%;top:16%;width:72%;height:44%;white-space:normal;text-wrap:balance;line-height:1.05;font-size:calc(min(28px, 280px / var(--n)))}
.news-flag .news-dot{right:-2%;top:-6%}
@keyframes newsWave{50%{transform:rotate(-2deg)}}
.news-balloon{position:absolute;left:-560px;top:190px;z-index:5;display:flex;align-items:center;gap:0;border:0;background:none;padding:0;cursor:pointer;animation:newsFly 52s linear forwards}
.news-ball{width:120px;animation:newsBob 3.2s ease-in-out infinite}
.news-tow{position:relative;width:440px;margin:70px -6px 0 0;animation:newsBob 3.2s ease-in-out infinite .4s}
.news-tow>img{display:block;width:100%;transform:scaleX(-1);filter:drop-shadow(0 5px 4px rgba(0,0,0,.2))}
.news-tow>span{left:7.9%;top:18.4%;width:65.4%;height:63.6%}
@keyframes newsFly{from{transform:translateX(0)}to{transform:translateX(var(--span))}}
@keyframes newsBob{50%{transform:translateY(-12px)}}
#mail-btn{position:absolute;right:22px;top:96px;z-index:8;width:66px;height:66px;border-radius:50%;border:3px solid var(--wood,#6b3f1f);background:var(--cream,#fff4dc);box-shadow:0 4px 0 var(--wood,#6b3f1f),0 8px 14px rgba(0,0,0,.2);cursor:pointer;padding:6px;transition:transform .2s cubic-bezier(.34,1.7,.5,1)}
#mail-btn img{width:100%;height:100%;object-fit:contain}
#mail-btn:hover,#mail-btn:focus-visible{transform:translateY(-2px) scale(1.06);outline:none}
#mail-btn .dot{position:absolute;right:-8px;top:-8px;min-width:24px;height:24px;border-radius:99px;background:#e2553f;color:#fff;font:900 14px/20px var(--f-body,system-ui);text-align:center;font-style:normal;border:2px solid #fff}
#mail-btn .dot[hidden],#mail-btn[hidden]{display:none}
#mail-btn.got{animation:newsGot .7s cubic-bezier(.34,1.7,.5,1)}
@keyframes newsGot{30%{transform:scale(1.25) rotate(-10deg)}60%{transform:scale(.95) rotate(6deg)}}
body:not([data-scene="map"]) #mail-btn{display:none}
.news-pigeon{position:fixed;left:100%;top:0;z-index:9500;width:110px;pointer-events:none;animation:newsPigeon 1.5s cubic-bezier(.3,.6,.4,1) forwards}
@keyframes newsPigeon{0%{transform:translate(40px,calc(var(--ty) + 120px)) scale(1)}60%{transform:translate(calc(var(--tx) - 30px),calc(var(--ty) - 30px)) scale(1)}100%{transform:translate(var(--tx),var(--ty)) scale(.4);opacity:.2}}
.news-card-flag{margin:0 0 10px;padding:8px 12px;border-radius:12px;background:#fff3f0;border:2px solid #e2553f;color:#7a2a18}
.news-card-flag p{margin:4px 0 0;font-size:15px}
.news-fac .row{display:flex;align-items:center;gap:10px}
.news-board-mini{width:64px;flex:none}
.news-new{font-style:normal;font:900 13px/1 var(--f-body,system-ui);color:#fff;background:#e2553f;padding:3px 8px;border-radius:99px;vertical-align:middle}
.nw-veil{position:fixed;inset:0;z-index:9002;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(20,30,50,.55);font:500 16px/1.6 "Noto Sans TC",system-ui,sans-serif;color:#3a2412;animation:nwIn .25s ease-out}
@keyframes nwIn{from{opacity:0}}
.nw-veil h2{margin:0;font:900 22px/1.3 "Noto Sans TC",system-ui,sans-serif}
.nw-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:6px}
.nw-btn{min-width:110px;padding:9px 18px;border:3px solid #6b3f1f;border-radius:999px;background:#ffe9bf;box-shadow:0 3px 0 #6b3f1f;font:900 16px/1 "Noto Sans TC",system-ui,sans-serif;color:#6b3f1f;cursor:pointer}
.nw-btn.go{background:#7ed957}
.nw-empty{margin:0;padding:14px;text-align:center;color:#8a6a4a}
.nw-letter{position:relative;width:min(440px,100%);max-height:88vh;overflow-y:auto;padding:22px 22px 16px;border-radius:8px;background:#fffaf0;background-image:repeating-linear-gradient(transparent 0 31px,#f0e2c6 31px 32px);box-shadow:0 14px 30px rgba(0,0,0,.35);animation:nwLetter .45s cubic-bezier(.34,1.5,.5,1)}
@keyframes nwLetter{from{transform:translateY(40px) rotate(-4deg) scale(.8);opacity:0}}
.nw-letter h2{color:#a5321c;margin-bottom:6px}
.nw-letter p{margin:0 0 8px;line-height:2}
.nw-sign{text-align:right;color:#8a6a4a;font-weight:700}
.nw-seal{position:absolute;right:14px;top:-14px;width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ff8a6a,#c8361f);border:3px solid #ffd7c9}
.nw-board{position:relative;width:min(560px,100%);max-height:88vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:14px;background:#c58c55;border:6px solid #8e5a2f;box-shadow:0 14px 30px rgba(0,0,0,.35)}
.nw-board h2{text-align:center;color:#fff7e6;text-shadow:0 2px 0 #6b3f1f}
.nw-board-art{position:absolute;left:8px;top:-6px;width:56px}
.nw-notes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.nw-note{position:relative;display:flex;flex-direction:column;gap:4px;padding:16px 10px 10px;border:0;background:#fffdf5;color:#3a2412;text-align:left;font:500 14px/1.45 "Noto Sans TC",system-ui,sans-serif;box-shadow:0 3px 6px rgba(0,0,0,.25);cursor:pointer;transition:transform .15s}
.nw-note:nth-child(odd){transform:rotate(-1.5deg)}.nw-note:nth-child(even){transform:rotate(1.5deg)}
.nw-note:hover,.nw-note:focus-visible{transform:rotate(0) scale(1.04);outline:none}
.nw-note b{font:900 16px/1.3 "Noto Sans TC",system-ui,sans-serif}
.nw-pin{position:absolute;left:50%;top:-6px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#9aa6a8;box-shadow:0 2px 0 rgba(0,0,0,.3)}
.nw-note.fresh .nw-pin{background:#e2553f}
.nw-note.fresh::after{content:"NEW";position:absolute;right:-6px;top:-8px;padding:1px 6px;border-radius:6px;background:#e2553f;color:#fff;font:900 11px/1.4 system-ui}
.nw-old summary{cursor:pointer;color:#fff7e6;font-weight:900;margin-bottom:8px}
.nw-old .nw-note{opacity:.8}
.nw-board>.nw-btn{align-self:center}
.nw-flyer{position:relative;width:min(400px,100%);display:flex;flex-direction:column;gap:8px;padding:24px 20px 16px;background:#fffdf5;box-shadow:0 14px 30px rgba(0,0,0,.35);transform:rotate(-1deg);animation:nwLetter .4s cubic-bezier(.34,1.5,.5,1)}
.nw-flyer .nw-pin{background:#e2553f;top:-7px}
.nw-flyer p{margin:0}
.nw-flyer small{color:#8a6a4a}
.nw-mail{width:min(440px,100%);max-height:88vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:20px;background:#fff4dc;border:3px solid #6b3f1f;box-shadow:0 5px 0 #6b3f1f,0 14px 26px rgba(0,0,0,.3)}
.nw-mail-art{width:64px;align-self:center}
.nw-mail h2{text-align:center}
.nw-list{display:flex;flex-direction:column;gap:6px}
.nw-item{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:12px;border:2px solid #f0dcb4;background:#fff;text-align:left;font:inherit;color:inherit;cursor:pointer}
.nw-item small{color:#8a6a4a;white-space:nowrap}
@media (max-width:700px),(max-height:520px){
  #mail-btn{right:10px;top:62px;width:50px;height:50px;border-width:2px;padding:4px}
}
@media (prefers-reduced-motion:reduce){.news-dot,.news-flag,.news-balloon,.news-ball,.news-tow{animation:none}}
`;
const st = document.createElement('style');
st.textContent = CSS;
document.head.appendChild(st);
