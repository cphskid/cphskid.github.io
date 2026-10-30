// 爸媽任務（資料庫在 supabase/park_parent.sql）。
//
// 不強制綁家長：孩子用禮物拜託爸媽，爸媽做一次就送孩子東西，任務不限天數、什麼時候做都可以。
// 功能列的「爸媽任務」打開卡片：5 項一次性任務＋每週的週末聯絡簿；還沒連起來的，按「拿給爸媽看」
// 秀 QR（帶一次性家長碼），爸媽掃了在後台註冊就連起來。做沒做到是伺服器判斷的，打開卡片時自動發獎。
import * as auth from './auth.js';
import { guide as installGuide } from './install.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const btn = $('#parent-btn');
const layer = $('#shop');          // 跟錢包、商店、新手手冊共用一個對話框層
const SEEN = 'park-parent-seen';   // 今天打開過卡片就不再亮紅點
let hooks = { me: () => ({ kind: 'guest' }), toast: () => {}, coins: () => {}, pets: () => {} };
let st = null;

const TASKS = {
  link:    { name: '和爸媽連起來', gift: '神秘蛋', art: 'img/parent/egg.webp' },
  view:    { name: '爸媽看過我的冒險', gift: '100 時光幣', art: 'img/ui/coin.webp' },
  sticker: { name: '爸媽送我鼓勵貼紙', gift: '親子長椅', art: 'img/pet/furniture/family-bench.webp' },
  goal:    { name: '完成爸媽訂的本週目標', gift: '每週 30 時光幣', art: 'img/ui/coin.webp' },
  app:     { name: '把樂園放到桌面', gift: '50 時光幣', art: 'img/app/icon-192.png' },
};
const STICKER = { great: '好棒', cheer: '加油', better: '有進步', careful: '好認真', love: '爸媽愛你', play: '一起玩' };

export function init(h) {
  hooks = { ...hooks, ...h };
  btn?.addEventListener('click', () => open());
}

export async function load(w = hooks.me()) {
  st = null;
  if (w.kind === 'student') {
    try { st = await auth.parent.me(); } catch { st = null; }
  }
  paint();
  if (st?.fresh?.length) announce(st.fresh);
  return st;
}

function announce(list) {
  list.forEach((t, i) => setTimeout(() => hooks.toast(`💌 ${t}`), i * 2600));
  sfx('SE-20');
  hooks.coins();
  if (list.some((t) => t.includes('神秘蛋') || t.includes('長椅') || t.includes('相框'))) hooks.pets();
}

const today = () => new Date().toLocaleDateString('sv');
function paint() {
  if (!btn) return;
  btn.hidden = !st;
  if (!st) return;
  const left = st.tasks.filter((t) => !t.done).length;
  let seen = '';
  try { seen = localStorage.getItem(SEEN) ?? ''; } catch { /* 無痕模式 */ }
  $('.dot', btn).hidden = (left === 0 && st.signed) || seen === today();
}

// 下一個動作：每一格都寫現在要做什麼（不要讓孩子不知道怎麼辦）
function next(code) {
  if (!st.linked && code === 'link') return '按上面的「拿給爸媽看」';
  if (!st.linked && code !== 'app') return '和爸媽連起來之後就能做';
  if (code === 'link') return `已經和 ${st.parents.map(esc).join('、')} 連起來了`;
  if (code === 'view') return '請爸媽打開後台，看看你的冒險';
  if (code === 'sticker') return '請爸媽在後台送你一張貼紙';
  if (code === 'goal') {
    if (!st.goal) return '請爸媽在後台幫你訂這週的目標';
    const s = st.stats ?? {};
    const now = { days3: `已經 ${s.days ?? 0} 天`, stamp2: `已經 ${s.stamps ?? 0} 個`, min60: `已經 ${s.minutes ?? 0} 分鐘` }[st.goal.code] ?? '';
    return st.goal.met ? `「${esc(st.goal.name)}」達成了！` : `這週目標：${esc(st.goal.name)}（${now}）`;
  }
  if (code === 'app') return '按這裡看怎麼做';
  return '';
}

function close() { layer.hidden = true; layer.innerHTML = ''; }
function show(html) {
  layer.innerHTML = html;
  layer.hidden = false;
  layer.onclick = (e) => { if (e.target === layer) close(); };
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}

export function open() {
  if (!st) return;
  try { localStorage.setItem(SEEN, today()); } catch { /* 無痕模式 */ }
  paint();
  const rows = st.tasks.map((t) => {
    const d = TASKS[t.code];
    const done = t.done && !(t.code === 'goal' && st.goal && !st.goal.met);
    return `<li class="${done ? 'got' : ''}${t.code === 'app' && !t.done ? ' tap' : ''}" ${t.code === 'app' && !t.done ? 'data-app role="button" tabindex="0"' : ''}>
      <span class="tk">${done ? '✓' : ''}</span>
      <p><b>${d.name}</b><small>${next(t.code)}</small></p>
      <span class="gift"><img src="${d.art}" alt=""><small>${esc(d.gift)}</small></span></li>`;
  }).join('');
  const stickers = (st.stickers ?? []).map((x) => `<span class="stk" title="${esc(x.from ?? '')}送的"><img src="img/parent/${esc(x.sticker)}.webp" alt="${esc(STICKER[x.sticker] ?? '')}"></span>`).join('');
  const signs = st.signs ?? 0;
  show(`<div class="wallet parent-card" role="dialog" aria-modal="true" aria-label="爸媽任務">
    <button class="x" data-close aria-label="關閉"></button>
    <h2><img src="img/parent/letter.webp" alt="">爸媽任務</h2>
    <p class="lead">請爸媽幫你完成，每一項都送你禮物。什麼時候做都可以，不會過期。</p>
    ${st.linked ? '' : `<div class="link-box"><img src="img/parent/egg.webp" alt=""><p><b>和爸媽連起來，送你神秘蛋！</b><span>按下面的按鈕，把畫面拿給爸媽掃一下。</span></p>
      <button type="button" class="btn small go" data-show>拿給爸媽看</button></div>`}
    <ul class="daily">${rows}</ul>
    <h3>週末聯絡簿 <small>每週一次</small></h3>
    <p class="week ${st.signed ? 'ok' : ''}">${st.signed ? '✓ 這週爸媽已經簽名了，+30 時光幣' : st.linked ? '請爸媽在後台看這週的冒險、按「簽名」，送你 30 時光幣' : '和爸媽連起來之後，每週爸媽簽名就送 30 時光幣'}</p>
    <div class="photo"><img src="img/pet/furniture/family-photo.webp" alt=""><p>簽滿 4 次送「全家福相框」<span class="bar"><i style="width:${Math.min(100, signs * 25)}%"></i></span><small>${Math.min(signs, 4)}/4</small></p></div>
    ${stickers ? `<h3>爸媽送的貼紙</h3><p class="stks">${stickers}</p>` : ''}
    ${st.linked && (st.parents?.length ?? 0) < 2 ? '<p class="tip"><button type="button" class="link" data-show>再連一位爸媽 ›</button></p>' : ''}
    <div class="row end"><button type="button" class="ghost" data-close>關閉</button></div>
  </div>`);
  layer.querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => showCode(); });
  const app = $('[data-app]', layer);
  if (app) app.onclick = () => { close(); installGuide(); };
}

// 給爸媽掃的 QR：網址帶一次性家長碼，爸媽掃了直接到後台「連起來」
let qrLib = null;
function loadQr() {
  qrLib ??= new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/qrcode.js';           // qrcode-generator 1.4.4（MIT）
    s.onload = () => ok(window.qrcode);
    s.onerror = bad;
    document.head.append(s);
  });
  return qrLib;
}
async function showCode() {
  show('<div class="wallet parent-card"><p class="lead">準備中…</p></div>');
  let c;
  try { c = await auth.parent.code(); } catch (e) { hooks.toast(e.message); close(); return; }
  const url = new URL(`teacher.html?parent=${c.code}`, location.href.split('#')[0]).href;
  let svg = '';
  try {
    const qr = (await loadQr())(0, 'M');
    qr.addData(url); qr.make();
    svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch { /* QR 載不到就只給代碼 */ }
  const text = `我在玩「時空冒險樂園」，幫我完成爸媽任務好嗎？打開這個連結就能和我連起來：${url}`;
  show(`<div class="wallet parent-card code" role="dialog" aria-modal="true" aria-label="拿給爸媽看">
    <button class="x" data-close aria-label="關閉"></button>
    <h2>拿給爸媽看</h2>
    <p class="lead">請爸媽用手機相機掃這個 QR，照著做就能和你連起來。</p>
    <div class="qr">${svg}</div>
    <p class="pcode">家長碼 <b>${esc(c.code)}</b><small>14 天內有效，用過一次就換新的</small></p>
    <div class="row center"><button type="button" class="btn small go" data-share>傳給爸媽</button></div>
    <p class="tip">爸媽不在旁邊？按「傳給爸媽」用 LINE 或簡訊傳過去。</p>
    <div class="row end"><button type="button" class="ghost" data-back>回爸媽任務</button></div>
  </div>`);
  $('[data-back]', layer).onclick = () => open();
  $('[data-share]', layer).onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: '時空冒險樂園：爸媽任務', text, url }); return; } catch { return; } }
    window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
}
