// 寵物島的天空：日夜跟著真的時間、季節跟著真的月份、天氣每 4 小時換一次（同一時段每個人看到的一樣）。
// 網址可以指定來看效果：?wx=sunny|cloudy|rain|snow|fog  &tod=day|dusk|night  &season=spring|summer|autumn|winter  &fest=halloween|none
// 節日（fest）：萬聖節＝10/20～10/31，島上擺小南瓜燈（pet.js），傍晚和晚上飛小蝙蝠。
const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
export const SKY_NAME = {
  wx: { sunny: '☀️ 晴天', cloudy: '⛅ 多雲', rain: '🌧️ 下雨', snow: '❄️ 下雪', fog: '🌫️ 起霧' },
  season: { spring: '🌸 春天', summer: '🌻 夏天', autumn: '🍁 秋天', winter: '⛄ 冬天' },
  tod: { day: '白天', dusk: '傍晚', night: '晚上' },
};

export function readSky(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  const tod = h >= 6 && h < 16.5 ? 'day' : h < 18.5 && h >= 16.5 ? 'dusk' : 'night';
  const season = SEASONS[now.getMonth()];
  // 用日期和時段當種子：每 4 小時換一次天氣（同一時段每個人看到的一樣）
  let x = (now.getFullYear() * 400 + now.getMonth() * 32 + now.getDate()) * 6 + Math.floor(now.getHours() / 4);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x ^= x >>> 16;
  const r = (x >>> 0) / 2 ** 32;
  let wx = r < .45 ? 'sunny' : r < .68 ? 'cloudy' : r < .9 ? 'rain' : 'fog';
  if (season === 'winter' && wx === 'rain' && r > .8) wx = 'snow';
  if (season === 'summer' && wx === 'fog') wx = 'sunny';
  const q = new URLSearchParams(location.search);
  const want = (k, list) => (list.includes(q.get(k)) ? q.get(k) : null);
  const fest = now.getMonth() === 9 && now.getDate() >= 20 ? 'halloween' : 'none';
  return {
    fest: want('fest', ['halloween', 'none']) ?? fest,
    wx: want('wx', Object.keys(SKY_NAME.wx)) ?? wx,
    tod: want('tod', Object.keys(SKY_NAME.tod)) ?? tod,
    season: want('season', Object.keys(SKY_NAME.season)) ?? season,
  };
}

// 粒子畫在島上面的一張 canvas：雨、雪、花瓣、落葉、螢火蟲、湖面的雨滴漣漪
export function makeSky(ground, sky, { w, h, lake }) {
  const cv = document.createElement('canvas');
  cv.className = 'sky';
  cv.width = w; cv.height = h;
  ground.appendChild(cv);
  const ctx = cv.getContext('2d');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = [];
  const add = (n, make) => { for (let i = 0; i < (calm ? Math.ceil(n / 4) : n); i++) parts.push(make(true)); };
  const R = Math.random;
  const rain = (first) => ({ k: 'rain', x: R() * w * 1.1, y: first ? R() * h : -20, v: 900 + R() * 300, l: 14 + R() * 10 });
  const snow = (first) => ({ k: 'snow', x: R() * w, y: first ? R() * h : -10, v: 40 + R() * 40, r: 2 + R() * 3, p: R() * 6 });
  const petal = (first) => ({ k: 'petal', x: first ? R() * w : -20, y: R() * h * .8, v: 40 + R() * 40, r: 4 + R() * 3, p: R() * 6, a: R() * 6 });
  const leaf = (first) => ({ ...petal(first), k: 'leaf', c: ['#e8892b', '#d4592a', '#f0b43a', '#b8752d'][Math.floor(R() * 4)] });
  const fly = () => ({ k: 'fly', x: w * (.2 + R() * .7), y: h * (.3 + R() * .5), p: R() * 6, s: .5 + R() });
  const ring = () => ({ k: 'ring', t: R(), x: 0, y: 0 });
  const bat = () => ({ k: 'bat', x: w * (.1 + R() * .8), y: h * (.08 + R() * .35), p: R() * 6, s: .6 + R() * .6, r: 30 + R() * 14 });
  let batImg = null;     // 萬聖節才抓這張圖
  if (sky.fest === 'halloween' && sky.tod !== 'day' && sky.wx !== 'rain') {
    batImg = new Image(); batImg.src = 'img/pet/bat.webp';
    add(5, bat);
  }
  if (sky.wx === 'rain') { add(150, rain); add(12, ring); }
  if (sky.wx === 'snow') add(110, snow);
  if (sky.wx !== 'rain' && sky.wx !== 'snow') {
    if (sky.season === 'spring') add(16, petal);
    if (sky.season === 'autumn') add(14, leaf);
  }
  if (sky.tod !== 'day' && sky.season !== 'winter' && sky.wx !== 'rain') add(sky.tod === 'night' ? 22 : 8, fly);
  let t = 0;
  function step(dt) {
    t += dt;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.k === 'rain') {
        p.y += p.v * dt; p.x -= p.v * dt * .18;
        if (p.y > h + 20) parts[i] = rain(false);
        ctx.strokeStyle = 'rgba(220,235,255,.55)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * .18, p.y - p.l); ctx.stroke();
      } else if (p.k === 'ring') {
        p.t += dt * .9;
        if (p.t > 1) {          // 新的一滴落在湖裡
          p.t = 0;
          const ang = R() * Math.PI * 2, d = Math.sqrt(R()) * .8;
          p.x = (lake.x + Math.cos(ang) * lake.rx * d) * w; p.y = (lake.y + Math.sin(ang) * lake.ry * d) * h;
        }
        if (!p.x) continue;
        ctx.strokeStyle = `rgba(255,255,255,${.6 * (1 - p.t)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 3 + p.t * 16, 1.5 + p.t * 6, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (p.k === 'snow') {
        p.y += p.v * dt; p.x += Math.sin(t * 1.3 + p.p) * 20 * dt;
        if (p.y > h + 10) parts[i] = snow(false);
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.k === 'petal' || p.k === 'leaf') {
        p.x += p.v * dt; p.y += (18 + Math.sin(t * 2 + p.p) * 22) * dt; p.a += dt * 2;
        if (p.x > w + 20 || p.y > h + 20) parts[i] = p.k === 'petal' ? petal(false) : leaf(false);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = p.k === 'petal' ? 'rgba(255,190,210,.95)' : p.c;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (p.k === 'bat') {
        if (!batImg.complete || !batImg.naturalWidth) continue;
        const x = p.x + Math.sin(t * .35 * p.s + p.p) * w * .12, y = p.y + Math.sin(t * .9 * p.s + p.p * 2) * 18;
        const flap = .65 + .35 * Math.abs(Math.sin(t * 9 * p.s + p.p));
        const bw = p.r * 1.75, bh = p.r;
        ctx.save(); ctx.translate(x, y); ctx.scale(Math.cos(t * .35 * p.s + p.p) < 0 ? -1 : 1, flap);
        ctx.globalAlpha = .9; ctx.drawImage(batImg, -bw / 2, -bh / 2, bw, bh); ctx.restore();
      } else if (p.k === 'fly') {
        const x = p.x + Math.sin(t * .6 * p.s + p.p) * 40, y = p.y + Math.cos(t * .8 * p.s + p.p) * 24;
        const a = .35 + .65 * Math.max(0, Math.sin(t * 2 * p.s + p.p));
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, `rgba(255,250,170,${a})`); g.addColorStop(1, 'rgba(255,240,120,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  return { step, empty: parts.length === 0 };
}

// ---------- 日夜天氣的顏色先算好（不用 CSS filter） ----------
// 島的底圖、地磚有 2640×1448 那麼大；掛 CSS filter 的話，手機放大時 iOS 會照放大後的尺寸重畫整張，
// 記憶體爆掉、網頁自己重新整理（「無法開啟這個網頁」）。所以把 --tod --wx 換成一個顏色矩陣，畫圖時直接算好。
// 回傳 3×4 矩陣（每列 r g b 位移，0～1），null＝不用變色
export function skyMatrix(filter) {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  let m = id;
  const mul = (a, b) => {          // a 套在 b 之後
    const o = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3] : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o.push(s);
    }
    return o;
  };
  const sat = (s) => [.213 + .787 * s, .715 - .715 * s, .072 - .072 * s, 0, .213 - .213 * s, .715 + .285 * s, .072 - .072 * s, 0, .213 - .213 * s, .715 - .715 * s, .072 + .928 * s, 0];
  for (const [, fn, arg] of String(filter).matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
    let v = parseFloat(arg);
    if (arg.includes('%')) v /= 100;
    let f = null;
    if (fn === 'brightness') f = [v, 0, 0, 0, 0, v, 0, 0, 0, 0, v, 0];
    else if (fn === 'contrast') { const o = .5 - .5 * v; f = [v, 0, 0, o, 0, v, 0, o, 0, 0, v, o]; }
    else if (fn === 'saturate') f = sat(v);
    else if (fn === 'sepia') {
      const a = 1 - Math.min(1, v);
      f = [.393 + .607 * a, .769 - .769 * a, .189 - .189 * a, 0, .349 - .349 * a, .686 + .314 * a, .168 - .168 * a, 0, .272 - .272 * a, .534 - .534 * a, .131 + .869 * a, 0];
    } else if (fn === 'hue-rotate') {
      const t = (arg.includes('turn') ? v * 360 : arg.includes('rad') ? v * 180 / Math.PI : v) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      f = [.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928, 0,
        .213 - c * .213 + s * .143, .715 + c * .285 + s * .14, .072 - c * .072 - s * .283, 0,
        .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072, 0];
    }
    if (f) m = mul(f, m);
  }
  return m.every((x, i) => Math.abs(x - id[i]) < 1e-4) ? null : m;
}
// '#rrggbb' 套矩陣
export function tintHex(m, hex) {
  if (!m || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return '#' + [0, 1, 2].map((r) => {
    const v = m[r * 4] * c[0] + m[r * 4 + 1] * c[1] + m[r * 4 + 2] * c[2] + m[r * 4 + 3];
    return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  }).join('');
}
// 把 img 畫進 canvas（固定解析度，放大縮小不會重畫）：先套顏色矩陣，再加島下面的影子（{ y, blur, color }，單位是 canvas 的像素）
export function paintTinted(cv, img, m, shadow) {
  const w = cv.width, h = cv.height, ctx = cv.getContext('2d');
  let src = img;
  if (m) {
    try {
      const t = document.createElement('canvas');
      t.width = w; t.height = h;
      const tc = t.getContext('2d', { willReadFrequently: true });
      tc.drawImage(img, 0, 0, w, h);
      const d = tc.getImageData(0, 0, w, h), px = d.data, k = m.map((x, i) => (i % 4 === 3 ? x * 255 : x));
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        px[i] = k[0] * r + k[1] * g + k[2] * b + k[3];
        px[i + 1] = k[4] * r + k[5] * g + k[6] * b + k[7];
        px[i + 2] = k[8] * r + k[9] * g + k[10] * b + k[11];
      }
      tc.putImageData(d, 0, 0);
      src = t;
    } catch { src = img; }
  }
  ctx.clearRect(0, 0, w, h);
  if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowOffsetY = shadow.y; ctx.shadowBlur = shadow.blur; }
  ctx.drawImage(src, 0, 0, w, h);
  ctx.shadowColor = 'transparent';
  if (src !== img) { src.width = 0; src.height = 0; }      // 暫用的 canvas 馬上放掉（iOS canvas 記憶體有上限）
}
