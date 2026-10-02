// 寵物島的天空：日夜跟著真的時間、季節跟著真的月份、天氣每天換一次（同一天每個人看到的一樣）。
// 網址可以指定來看效果：?wx=sunny|cloudy|rain|snow|fog  &tod=day|dusk|night  &season=spring|summer|autumn|winter
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
  // 用日期當種子，一天換一次天氣
  let x = now.getFullYear() * 512 + now.getMonth() * 32 + now.getDate();
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  const r = (x >>> 0) / 2 ** 32;
  let wx = r < .45 ? 'sunny' : r < .68 ? 'cloudy' : r < .9 ? 'rain' : 'fog';
  if (season === 'winter' && wx === 'rain' && r > .8) wx = 'snow';
  if (season === 'summer' && wx === 'fog') wx = 'sunny';
  const q = new URLSearchParams(location.search);
  const want = (k, list) => (list.includes(q.get(k)) ? q.get(k) : null);
  return {
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
