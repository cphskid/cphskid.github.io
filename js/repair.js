// 時光修理站（2026-10-23）：地圖上的一座小島，把「改版紀錄」變成小朋友會好奇去點的地方。
//
//   🔧 最新修好的：樂園、島嶼開拓者、守護異世界三份 changelog.json 合在一起，最新的在上面。
//                  版本裡有 thanks（["小緹"]）就寫「💡 謝謝 小緹 的建議」。
//   💡 小幫手牆：data/helpers.json，建議或回報被採用的小朋友（只放暱稱）。登入的人看到自己的名字會發亮。
//   💬 我要回報：直接開問題回報（js/feedback.js）。
//
// 有新版本（任一遊戲最新版號跟上次點進來看到的不一樣）時，島上冒出 NEW，點進來看過就消失。

const IS_DEV = /^\/dev(\/|$)/.test(location.pathname);
// 各遊戲的更新說明放在自己網站底下；樂園測試站讀各遊戲的測試站
const GAMES = [
  { code: 'park', name: '樂園', url: 'data/changelog.json' },
  { code: 'island', name: '島嶼開拓者', url: IS_DEV ? '/Taiwan-island/dev/changelog.json' : '/Taiwan-island/changelog.json' },
  { code: 'guardian', name: '守護異世界', url: IS_DEV ? '/gaming_english_practice/dev/changelog.json' : '/gaming_english_practice/changelog.json' },
];
const SEEN_KEY = 'park.repair.seen';
const SHOW = 15; // 最新修好的：最多列幾版

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (v) => String(v).replace(/\.0$/, '');

async function json(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

let logs = null; // Promise<[{game, versions}]>
const loadLogs = () => (logs ??= Promise.all(GAMES.map(async (g) => ({ game: g, versions: (await json(g.url))?.versions ?? [] }))));
let helpers = null;
const loadHelpers = () => (helpers ??= json('data/helpers.json').then((d) => d?.helpers ?? []));

function seen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function markSeen(all) {
  const s = Object.fromEntries(all.map((l) => [l.game.code, l.versions[0]?.version ?? '']));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* 無痕模式：下次照樣顯示 NEW */ }
}
// 第一次來（什麼都沒看過）也算有新東西，讓小朋友知道這裡會更新
const hasNew = (all) => { const s = seen(); return all.some((l) => l.versions[0] && s[l.game.code] !== l.versions[0].version); };

let me = () => null;
let button = null;

export function init({ host, slot, me: who, dragged = () => false }) {
  me = who;
  if (!slot) return;
  const b = document.createElement('button');
  b.className = 'isle repair-isle';
  b.style.cssText = `left:${slot.left}px;top:${slot.top}px;width:${slot.width}px;--delay:-4s`;
  b.setAttribute('aria-label', '時光修理站：看看最近修好了什麼');
  b.innerHTML = '<div class="bob"><div class="lift"><div class="foam"></div><img class="art" src="img/l-08.webp" alt=""><span class="repair-new" hidden>NEW</span></div></div>'
    + '<div class="plate"><b>時光修理站</b><span>最近修好了什麼？</span></div>';
  b.addEventListener('click', () => { if (!dragged()) open(); });
  host.appendChild(b);
  button = b;
  loadLogs().then((all) => { b.querySelector('.repair-new').hidden = !hasNew(all); });
  return b;
}

const CSS = `
.isle.repair-isle .art{width:100%}
.repair-new{position:absolute;right:8%;top:4%;padding:4px 10px;border-radius:999px;background:#e2553f;color:#fff;border:3px solid #fff;font:900 15px/1 var(--f-body,system-ui);box-shadow:0 3px 0 #8a2a1a;animation:repairPing 1s ease-in-out infinite alternate}
@keyframes repairPing{from{transform:scale(1) rotate(-6deg)}to{transform:scale(1.15) rotate(6deg)}}
.rp-veil{position:fixed;inset:0;z-index:9002;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(20,30,50,.55)}
.rp-box{width:min(520px,100%);max-height:88vh;display:flex;flex-direction:column;gap:10px;padding:14px 16px 16px;background:#fff4dc;border:3px solid #6b3f1f;border-radius:20px;box-shadow:0 5px 0 #6b3f1f,0 14px 26px rgba(0,0,0,.3);font:500 15px/1.5 "Noto Sans TC",system-ui,sans-serif;color:#3a2412}
.rp-head{display:flex;align-items:center;gap:10px}
.rp-head img{width:64px;height:64px;object-fit:contain;flex:none}
.rp-head h2{margin:0;font:900 21px/1.2 "Noto Sans TC",system-ui,sans-serif}
.rp-head p{margin:2px 0 0;font-size:14px;color:#8a6a4a}
.rp-tabs{display:flex;gap:6px}
.rp-tabs button{flex:1;padding:8px 4px;white-space:nowrap;font-size:14px !important;border:3px solid #c9a46b;border-radius:14px;background:#fffaf0;font:900 15px/1.2 "Noto Sans TC",system-ui,sans-serif;color:#6b3f1f;cursor:pointer}
.rp-tabs button.on{background:#ffd877;border-color:#6b3f1f}
.rp-body{overflow-y:auto;min-height:120px;display:flex;flex-direction:column;gap:10px;padding-right:2px}
.rp-ver{padding:8px 10px;border-radius:14px;background:#fff;border:2px solid #f0dcb4}
.rp-ver.fresh{border-color:#e2553f}
.rp-ver header{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.rp-ver header b{font-weight:900}
.rp-ver header small{color:#8a6a4a;font-size:12px;margin-left:auto}
.rp-game{padding:1px 8px;border-radius:999px;font:900 12px/1.6 "Noto Sans TC",system-ui,sans-serif;color:#fff;background:#6b8f3a}
.rp-game.g-island{background:#2e86c1}
.rp-game.g-guardian{background:#8e44ad}
.rp-ver ul{margin:4px 0 0;padding-left:20px}
.rp-thanks{margin-top:4px;padding:3px 10px;border-radius:10px;background:#fff3c4;font-weight:900;color:#a0601c}
.rp-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.rp-helper{padding:8px 10px;border-radius:14px;background:#fff;border:2px solid #f0dcb4;text-align:center}
.rp-helper b{display:block;font:900 18px/1.3 "Noto Sans TC",system-ui,sans-serif}
.rp-helper small{display:block;color:#8a6a4a;font-size:12px;line-height:1.4}
.rp-helper.me{border-color:#ffb02e;background:#fff3c4;box-shadow:0 0 0 3px #ffe066,0 0 14px #ffb02e}
.rp-helper.me b::after{content:"（是你！）";font-size:13px;color:#e2553f}
.rp-tip{margin:0;padding:8px 10px;border-radius:12px;background:#e9fbe6;font-weight:700;color:#2e6b22}
.rp-btn{align-self:center;min-width:140px;padding:9px 18px;border:3px solid #6b3f1f;border-radius:999px;background:#ffe9bf;box-shadow:0 3px 0 #6b3f1f;font:900 16px/1 "Noto Sans TC",system-ui,sans-serif;color:#6b3f1f;cursor:pointer}
.rp-btn.go{background:#7ed957}
`;
let styled = false;
function style() {
  if (styled) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styled = true;
}
style();

const GAME_NAME = Object.fromEntries(GAMES.map((g) => [g.code, g.name]));
function withThanks(l, e, help) {
  const more = help.filter((h) => h.ver === e.version && h.game === GAME_NAME[l.game.code]).map((h) => h.who);
  const thanks = [...new Set([...(e.thanks || []), ...more])];
  return thanks.length ? { ...e, thanks } : e;
}

function verHtml(l, e, fresh) {
  const thanks = (e.thanks || []).filter(Boolean);
  return `<article class="rp-ver ${fresh ? 'fresh' : ''}"><header><span class="rp-game g-${l.game.code}">${esc(l.game.name)}</span><b>${esc(e.title)}</b><small>${esc(e.date)}・v${esc(short(e.version))}</small></header>`
    + `<ul>${(e.items || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    + (thanks.length ? `<div class="rp-thanks">💡 謝謝 ${thanks.map(esc).join('、')} 的建議！</div>` : '')
    + '</article>';
}

async function paintNews(body, before) {
  const all = await loadLogs();
  const help = await loadHelpers();
  // 小朋友只看給學生的版本（audience: staff 是只寫給老師的）；小幫手牆有標 ver 的，也寫進那一版的謝謝
  const rows = all.flatMap((l) => l.versions.map((e, i) => ({ l, e: withThanks(l, e, help), i }))).filter((r) => r.e.audience !== 'staff');
  // 新的在上面；同一天就照各遊戲自己的順序
  rows.sort((a, b) => String(b.e.date).localeCompare(String(a.e.date)) || a.i - b.i);
  if (!rows.length) { body.innerHTML = '<p>修理站的工作日誌找不到了，等一下再來看看。</p>'; return; }
  const fresh = (r) => {
    const v = before[r.l.game.code];
    if (!v) return r.i === 0;
    const k = r.l.versions.findIndex((e) => e.version === v);
    return k < 0 ? r.i === 0 : r.i < k;
  };
  body.innerHTML = '<p class="rp-tip">滴答和工程師們最近修好、做好的東西都在這裡。紅框是你還沒看過的！</p>'
    + rows.slice(0, SHOW).map((r) => verHtml(r.l, r.e, fresh(r))).join('');
}

async function paintWall(body) {
  const list = await loadHelpers();
  const who = me();
  const mine = who?.kind === 'student' ? who.nickname : null;
  // 同一個暱稱合成一格：幫了幾次、最近一次幫了什麼
  const by = new Map();
  for (const h of list) {
    const x = by.get(h.who) ?? { who: h.who, n: 0, last: h };
    x.n += 1;
    if (String(h.date) > String(x.last.date)) x.last = h;
    by.set(h.who, x);
  }
  const cards = [...by.values()].sort((a, b) => String(b.last.date).localeCompare(String(a.last.date)));
  body.innerHTML = '<p class="rp-tip">這些小幫手告訴我們哪裡壞了、哪裡看不懂，樂園才越來越好玩！你的回報被採用，名字也會出現在這裡喔。</p>'
    + (cards.length ? `<div class="rp-wall">${cards.map((c) => `<div class="rp-helper ${c.who === mine ? 'me' : ''}"><b>${esc(c.who)}</b><small>幫忙 ${c.n} 次・${esc(c.last.game)}</small><small>${esc(c.last.what)}</small></div>`).join('')}</div>`
      : '<p>還沒有人上榜，你來當第一個小幫手吧！</p>');
}

function paintReport(body, close) {
  body.innerHTML = '<p class="rp-tip">遊戲哪裡壞掉、哪裡看不懂、想要什麼新東西，都可以告訴我們。被採用的話，你的名字會出現在小幫手牆和更新說明裡！</p>'
    + '<button class="rp-btn go" type="button">💬 我要回報</button>';
  body.querySelector('button').addEventListener('click', () => { close(); window.ParkFeedback?.open(); });
  if (!window.ParkFeedback) body.querySelector('button').hidden = true;
}

export async function open() {
  const before = seen();
  const veil = document.createElement('div');
  veil.className = 'rp-veil';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.innerHTML = `<div class="rp-box">
    <div class="rp-head"><img src="img/tick/point.webp" alt=""><div><h2>時光修理站</h2><p>看看最近修好了什麼，還有幫忙的小幫手們！</p></div></div>
    <div class="rp-tabs"><button type="button" data-t="news" class="on">🔧 修好了什麼</button><button type="button" data-t="wall">💡 小幫手牆</button><button type="button" data-t="report">💬 我要回報</button></div>
    <div class="rp-body"><p>翻開工作日誌中…</p></div>
    <button class="rp-btn" type="button" data-close>關閉</button></div>`;
  const close = () => { veil.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  const body = veil.querySelector('.rp-body');
  const show = (t) => {
    veil.querySelectorAll('.rp-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'news') paintNews(body, before);
    else if (t === 'wall') paintWall(body);
    else paintReport(body, close);
  };
  veil.addEventListener('click', (e) => {
    if (e.target === veil || e.target.closest('[data-close]')) return close();
    const t = e.target.closest('.rp-tabs button');
    if (t) show(t.dataset.t);
  });
  document.body.appendChild(veil);
  show('news');
  const all = await loadLogs();
  markSeen(all);
  button?.querySelector('.repair-new')?.setAttribute('hidden', '');
}
