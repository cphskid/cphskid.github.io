// 聖誕卡分享（2026-11-27 Chuck：大聖誕樹那邊做圖卡分享，自己打字、6 張卡面、配時光旅人、最下面一小列網址＋QR code；寵物島版 Chuck 看了說拿掉）
// 卡片直接畫在 <canvas>（1080×1350），預覽就是成品；按「分享給朋友」用手機的分享選單（LINE 等），不支援就存成圖片。
// 隱私：卡上不放真名、班級、學校；暱稱預設不寫，要自己勾；打字擋電話、網址、Email。
// 活動期間第一次寄出（分享或存圖）送 5 片雪花（park_snow_card_done，只送一次）。
import { sfx } from './audio.js';

const W = 1080, H = 1350, FOOT = 110;
const URL_TEXT = 'timepark.ciyulab.com';
const URL_LINK = 'https://timepark.ciyulab.com/';
const CARDS = [1, 2, 3, 4, 5, 6];
const WISHES = ['聖誕快樂！', '一起來點亮大聖誕樹！', '祝你新年快樂！', '謝謝你陪我一起玩', '我們樂園見！'];
const MAX = 30;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 圖片快取（同一張卡面不用重抓）
const imgs = new Map();
function img(src) {
  if (!imgs.has(src)) {
    imgs.set(src, new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; }));
  }
  return imgs.get(src);
}
let qrLib = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLib ??= new Promise((ok) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/qrcode.js';   // qrcode-generator 1.4.4（MIT），家長綁定也用這個
    s.onload = () => ok(window.qrcode ?? null);
    s.onerror = () => { qrLib = null; ok(null); };
    document.head.appendChild(s);
  });
  return qrLib;
}

// 打的字不能有電話、網址、Email（孩子的個資不要跟著卡片傳出去）
export function badText(t) {
  const s = String(t ?? '');
  if (/\d[\d\s-]{5,}\d/.test(s) || (s.match(/\d/g) ?? []).length >= 6) return '卡片上不能寫電話或一長串數字喔';
  if (/@|https?:|www\.|\.com|\.tw/i.test(s)) return '卡片上不能寫網址或 Email 喔';
  return '';
}

// 時光旅人的每一層圖（跟 traveller.dollHtml 一樣的順序；頭髮被帽子蓋住的地方用遮罩剪掉）
function dollLayers(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  return [...box.querySelectorAll('img')].map((im) => {
    const m = (im.getAttribute('style') ?? '').match(/mask-image:url\(([^)]+)\)/);
    return { src: im.getAttribute('src'), mask: m ? m[1] : null };
  });
}
async function drawDoll(ctx, layers, x, y, w, h) {
  for (const L of layers) {
    const im = await img(L.src);
    if (!im) continue;
    if (!L.mask) { ctx.drawImage(im, x, y, w, h); continue; }
    const mk = await img(L.mask);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, w, h);
    if (mk) { g.globalCompositeOperation = 'destination-in'; g.drawImage(mk, 0, 0, w, h); }
    ctx.drawImage(c, x, y);
  }
}
function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}
function round(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';

// 把整張卡畫出來
async function draw(cv, o) {
  const ctx = cv.getContext('2d');
  const bg = await img(`img/xmas/card/c${o.card}.webp`);
  ctx.clearRect(0, 0, W, H);
  if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#1f3c78'; ctx.fillRect(0, 0, W, H); }
  // 標題
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `900 118px ${FONT}`;
  ctx.lineJoin = 'round'; ctx.lineWidth = 18; ctx.strokeStyle = '#a3321f';
  ctx.strokeText('聖誕快樂！', W / 2, 150);
  ctx.fillStyle = '#ffe48a'; ctx.fillText('聖誕快樂！', W / 2, 150);
  // 想說的話（白色圓角框，任何卡面都看得清楚）
  const msg = (o.text || '').trim();
  if (msg) {
    ctx.font = `800 54px ${FONT}`;
    const lines = wrap(ctx, msg, 860).slice(0, 2);
    const bh = 40 + lines.length * 70;
    ctx.fillStyle = 'rgba(255,250,238,.9)'; round(ctx, 90, 190, 900, bh, 32); ctx.fill();
    ctx.fillStyle = '#6b3f1d';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, 190 + 20 + 54 + i * 70));
  }
  const bottom = H - FOOT;
  // 主角：時光旅人站左邊，或寵物島照片（拍立得框）
  if (o.doll?.length) {
    const dw = 470, dh = dw * 600 / 448;
    await drawDoll(ctx, o.doll, 40, bottom - dh - 10, dw, dh);
  }
  // 署名（勾了才寫暱稱）
  if (o.sign && o.nick) {
    const pm = false;
    ctx.textAlign = 'left'; ctx.font = `900 50px ${FONT}`;
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(40,20,10,.75)';
    const t = `— ${o.nick}`;
    const x = pm ? W - 50 : 520, y = bottom - 30;
    ctx.strokeText(t, x, y); ctx.fillStyle = '#fff'; ctx.fillText(t, x, y);
  }
  // 最下面一小列：樂園 logo、網址、QR code
  ctx.fillStyle = 'rgba(255,248,232,.97)'; ctx.fillRect(0, bottom, W, FOOT);
  const logo = await img('img/logo.webp');
  if (logo) ctx.drawImage(logo, 24, bottom + 12, 172, 86);
  ctx.textAlign = 'left'; ctx.fillStyle = '#6b3f1d';
  ctx.font = `900 38px ${FONT}`; ctx.fillText('時光冒險樂園', 214, bottom + 50);
  ctx.font = `700 32px ${FONT}`; ctx.fillStyle = '#8a5a2a'; ctx.fillText(URL_TEXT, 214, bottom + 90);
  const qr = await loadQr();
  if (qr) {
    const q = qr(0, 'M'); q.addData(URL_LINK); q.make();
    const n = q.getModuleCount(), size = 92, cell = size / n, x0 = W - size - 20, y0 = bottom + (FOOT - size) / 2;
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 - 4, y0 - 4, size + 8, size + 8);
    ctx.fillStyle = '#2b1a0c';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(x0 + c * cell, y0 + r * cell, Math.ceil(cell), Math.ceil(cell));
  }
}

const toBlob = (cv) => new Promise((ok) => { try { cv.toBlob(ok, 'image/png'); } catch { ok(null); } });

let veil = null;
// ctx：{ nick, dollHtml, onSent()（第一次寄出送雪花，回傳拿到幾片）, cardDone（已經拿過） }
export function openCard(ctx = {}) {
  veil?.remove();
  const o = { card: 1, mode: 'doll', text: WISHES[0], sign: false, nick: ctx.nick ?? '',
              doll: ctx.dollHtml ? dollLayers(ctx.dollHtml) : [] };
  veil = document.createElement('div');
  veil.className = 'snow-veil';
  veil.innerHTML = `<div class="snow-box xcard" role="dialog" aria-modal="true" aria-label="寄聖誕卡">
    <button class="x" data-close aria-label="關閉"></button>
    <h2>寄一張聖誕卡給朋友</h2>
    <div class="xc-body">
      <div class="xc-prev"><canvas width="${W}" height="${H}" aria-label="聖誕卡預覽"></canvas></div>
      <div class="xc-ctl">
        <p class="lab">① 挑卡面</p>
        <div class="xc-cards">${CARDS.map((n) => `<button type="button" data-card="${n}" aria-label="卡面 ${n}" class="${n === 1 ? 'on' : ''}"><img src="img/xmas/card/c${n}-s.webp" alt=""></button>`).join('')}</div>
        <p class="lab">② 想說的話（最多 ${MAX} 字）</p>
        <div class="xc-wish">${WISHES.map((w) => `<button type="button" data-wish="${esc(w)}">${esc(w)}</button>`).join('')}</div>
        <input class="xc-in" maxlength="${MAX}" value="${esc(o.text)}" aria-label="想說的話" autocomplete="off">
        <p class="xc-warn">不要寫真名、學校、電話喔！</p>
        ${o.nick ? `<label class="xc-sign"><input type="checkbox" data-sign> 寫上我的暱稱「${esc(o.nick)}」</label>` : ''}
        ${ctx.cardDone ? '' : '<p class="xc-gift"><img src="img/xmas/snow.webp" alt="">第一次寄出聖誕卡，送你 5 片雪花！</p>'}
        <p class="xc-msg" hidden></p>
        <div class="xc-btns"><button type="button" class="ghost" data-save>存成圖片</button><button type="button" class="btn go" data-share>分享給朋友</button></div>
      </div>
    </div></div>`;
  document.body.appendChild(veil);
  const cv = $('canvas', veil), input = $('.xc-in', veil), msgEl = $('.xc-msg', veil);
  let busy = false, again = false;
  async function paint() {
    if (busy) { again = true; return; }
    busy = true;
    try { await draw(cv, o); } finally { busy = false; }
    if (again) { again = false; paint(); }
  }
  function sync() {
    veil.querySelectorAll('[data-card]').forEach((b) => b.classList.toggle('on', +b.dataset.card === o.card));
    paint();
  }
  function say(text, kind = 'bad') { msgEl.hidden = !text; msgEl.className = `xc-msg ${kind}`; msgEl.textContent = text; }
  const shut = () => { veil?.remove(); veil = null; };
  veil.addEventListener('click', async (e) => {
    if (e.target === veil || e.target.closest('[data-close]')) return shut();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.card) { o.card = +b.dataset.card; sfx('SE-03'); sync(); }
    else if (b.dataset.wish) { o.text = b.dataset.wish; input.value = o.text; say(''); paint(); }
    else if (b.hasAttribute('data-save') || b.hasAttribute('data-share')) send(b.hasAttribute('data-share'));
  });
  input.addEventListener('input', () => {
    const bad = badText(input.value);
    say(bad);
    if (!bad) { o.text = input.value; paint(); }
  });
  $('[data-sign]', veil)?.addEventListener('change', (e) => { o.sign = e.target.checked; paint(); });

  async function send(share) {
    if (badText(input.value)) return say(badText(input.value));
    await draw(cv, o);
    const blob = await toBlob(cv);
    if (!blob) return say('卡片做不出來，換一張卡面再試試');
    const file = new File([blob], 'christmas-card.png', { type: 'image/png' });
    let sent = false;
    if (share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '聖誕快樂！', text: `聖誕快樂！一起來時光冒險樂園玩：${URL_LINK}` }); sent = true; }
      catch (err) { if (err?.name === 'AbortError') return; }   // 自己按取消就算了
    }
    if (!sent) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'christmas-card.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      sent = true;
      say(share ? '這台裝置不能直接分享，已經存成圖片，可以從相簿或下載資料夾傳給朋友。' : '存好了！可以從相簿或下載資料夾傳給朋友。', 'ok');
    } else say('寄出去了！', 'ok');
    sfx('SE-20');
    try {
      const got = await ctx.onSent?.();
      if (got > 0) { say(`寄出去了！第一次寄聖誕卡，送你 ${got} 片雪花！`, 'ok'); $('.xc-gift', veil)?.remove(); }
    } catch { /* 雪花沒發到也不影響卡片 */ }
  }
  sync();
}
