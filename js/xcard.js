// 聖誕卡分享（2026-11-27 Chuck：大聖誕樹那邊做圖卡分享，自己打字、6 張卡面、配時光旅人或寵物島照片、最下面一小列網址＋QR code）
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
  if (o.mode === 'pet' && o.photo) {
    // 寵物島（去背的島）浮在卡片下半部，底下一圈柔柔的影子
    const ph = await img(o.photo);
    if (ph) {
      const top = msg ? 420 : 300, maxW = 980, maxH = bottom - top - 30;
      const sc = Math.min(maxW / ph.width, maxH / ph.height);
      const w = ph.width * sc, h = ph.height * sc, x = (W - w) / 2, y = bottom - 30 - h;
      ctx.save();
      ctx.fillStyle = 'rgba(10,30,60,.28)';
      ctx.beginPath(); ctx.ellipse(W / 2, bottom - 30, w * .42, 34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.drawImage(ph, x, y, w, h);
    }
  } else if (o.doll?.length) {
    const dw = 470, dh = dw * 600 / 448;
    await drawDoll(ctx, o.doll, 40, bottom - dh - 10, dw, dh);
  }
  // 署名（勾了才寫暱稱）
  if (o.sign && o.nick) {
    const pm = o.mode === 'pet' && o.photo;
    ctx.textAlign = pm ? 'right' : 'left'; ctx.font = `900 50px ${FONT}`;
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
// ctx：{ nick, dollHtml, photo（dataURL/blob URL，可無）, openPet()（去寵物島拍）, onSent()（第一次寄出送雪花，回傳拿到幾片）, cardDone（已經拿過） }
export function openCard(ctx = {}) {
  veil?.remove();
  const o = { card: 1, mode: ctx.photo ? 'pet' : 'doll', text: WISHES[0], sign: false, nick: ctx.nick ?? '', photo: ctx.photo ?? null,
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
        <p class="lab">② 卡片上放</p>
        <div class="xc-seg"><button type="button" data-mode="doll">我的時光旅人</button><button type="button" data-mode="pet">我的寵物島</button></div>
        <p class="xc-pethint" hidden>到寵物島按右邊的「寄卡片」，就會拍下你的島放進卡片。<button type="button" class="link" data-go-pet>去寵物島拍一張 ›</button></p>
        <p class="lab">③ 想說的話（最多 ${MAX} 字）</p>
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
    veil.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === o.mode));
    $('.xc-pethint', veil).hidden = !(o.mode === 'pet' && !o.photo);
    paint();
  }
  function say(text, kind = 'bad') { msgEl.hidden = !text; msgEl.className = `xc-msg ${kind}`; msgEl.textContent = text; }
  const shut = () => { veil?.remove(); veil = null; };
  veil.addEventListener('click', async (e) => {
    if (e.target === veil || e.target.closest('[data-close]')) return shut();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.card) { o.card = +b.dataset.card; sfx('SE-03'); sync(); }
    else if (b.dataset.mode) { o.mode = b.dataset.mode; sfx('SE-03'); sync(); }
    else if (b.dataset.wish) { o.text = b.dataset.wish; input.value = o.text; say(''); paint(); }
    else if (b.hasAttribute('data-go-pet')) { shut(); ctx.openPet?.(); }
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
    if (o.mode === 'pet' && !o.photo) return say('先去寵物島拍一張照片，或改放你的時光旅人');
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

// 寵物島拍一張（寄卡片用）：不是截整個畫面，而是把「島本身」重畫一次——地面（canvas.land）＋島上的樹、傢俱、夥伴，
// 照畫面上的前後順序畫進新的畫布，再裁到島的範圍（外面透明）。按鈕、對話泡泡、名牌、海都不會進去。失敗回 null
const SKIP = '.bub,.wish,.tag,.farm-tag,.fish-spot,.shadow';
function flipped(el, stop) {
  let neg = false;
  for (let e = el; e && e !== stop; e = e.parentElement) {
    const t = getComputedStyle(e).transform;
    const m = t && t !== 'none' ? t.match(/matrix\(([^,]+)/) : null;
    if (m && parseFloat(m[1]) < 0) neg = !neg;
  }
  return neg;
}
export async function shootIsle(ground) {
  try {
    const land = ground?.querySelector('canvas.land');
    if (!land) return null;
    const GW = parseFloat(ground.style.width) || land.width, GH = parseFloat(ground.style.height) || land.height;
    const gr = ground.getBoundingClientRect();
    const s = GW / gr.width, k = Math.min(1, 1400 / GW);
    const c = document.createElement('canvas');
    c.width = Math.round(GW * k); c.height = Math.round(GH * k);
    const g = c.getContext('2d');
    g.drawImage(land, 0, 0, c.width, c.height);
    const zOf = (el) => { const h = el.closest('.actors > *'); return h ? (parseInt(h.style.zIndex, 10) || 0) : 0; };
    const list = [...ground.querySelectorAll('.actors img')].filter((im) => im.complete && im.naturalWidth && !im.closest(SKIP)
      && getComputedStyle(im).visibility !== 'hidden' && getComputedStyle(im).opacity !== '0');
    const order = list.map((im, i) => ({ im, i, z: zOf(im) })).sort((a, b) => a.z - b.z || a.i - b.i);
    for (const { im } of order) {
      const r = im.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const x = (r.left - gr.left) * s * k, y = (r.top - gr.top) * s * k, w = r.width * s * k, h = r.height * s * k;
      // object-fit: contain 的圖要照比例放在框中間
      const ar = im.naturalWidth / im.naturalHeight;
      let dw = w, dh = h;
      if (getComputedStyle(im).objectFit === 'contain') { if (w / h > ar) dw = h * ar; else dh = w / ar; }
      const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
      if (flipped(im, ground)) { g.save(); g.translate(dx + dw, dy); g.scale(-1, 1); g.drawImage(im, 0, 0, dw, dh); g.restore(); }
      else g.drawImage(im, dx, dy, dw, dh);
    }
    // 裁到有東西的範圍（島外面是透明的）
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 <= x0 || y1 <= y0) return null;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 2; out.height = y1 - y0 + 2;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/png');
    c.width = c.height = out.width = out.height = 0;
    return url;
  } catch { return null; }
}
