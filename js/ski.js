// 聖誕活動：雪山滑雪橇（2026-11-19 Chuck：玩法像 Ski Safari 那種無盡下坡，提案頁第二版 A）
// 自己的夥伴坐雪橇往下衝，後面雪崩在追，被追上就結束。
//   點一下＝跳；在空中按住＝後空翻，平穩落地加速（翻越多圈加速越久）；落地歪掉會摔一下變慢。
//   坐騎：麋鹿（空中多跳一次）、小北極熊（撞開石頭）、大雪球（滾過一切，6 秒後散掉）。從坐騎摔下來不算輸，回到雪橇。
//   撿雪花、禮物；經過山腳小屋時禮物丟進煙囪，一個禮物多 1 片雪花。
//   夥伴本事：獨角獸、藍鵲多跳一次；小火龍撞石頭不會摔；小貓、石虎吸雪花範圍大。
// 一趟結束把撿到的雪花和距離送到 park_snow_ski_done（每天最多 12 片，伺服器算）。
import * as auth from './auth.js';
import * as snow from './snow.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPRITES = ['deer', 'bear', 'ball', 'rock', 'gift', 'house', 'pine', 'wave', 'sled'];
const ABILITY = {
  unicorn: ['air', '獨角獸：空中可以多跳一次'], magpie: ['air', '藍鵲：空中可以多跳一次'],
  dragon: ['rock', '小火龍：撞到石頭也不會摔'], kitten: ['magnet', '小貓：吸雪花的範圍比較大'], 'leopard-cat': ['magnet', '石虎：吸雪花的範圍比較大'],
};

let veil = null, raf = 0, imgs = {};
function load(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

export async function openSki({ pet, onClose } = {}) {
  close();
  veil = document.createElement('div');
  veil.className = 'snow-veil ski';
  document.body.appendChild(veil);
  const species = pet?.species ?? 'kitten', stage = pet?.stage ?? 1;
  const ab = ABILITY[species] ?? null;
  const base = 'img/xmas/ski-';
  const list = await Promise.all([...SPRITES.map((k) => load(`${base}${k}.webp`)), load(`img/pet/${species}/${stage}-sit.webp`), load(`img/pet/${species}/${stage}-jump.webp`), load('img/xmas/snow.webp')]);
  SPRITES.forEach((k, i) => { imgs[k] = list[i]; });
  imgs.pet = list[SPRITES.length]; imgs.petJump = list[SPRITES.length + 1] ?? imgs.pet; imgs.snow = list[SPRITES.length + 2];
  intro();

  function intro(msg = null) {
    const s = snow.state();
    veil.innerHTML = `<div class="snow-box ski-intro" role="dialog" aria-modal="true" aria-label="雪山滑雪橇">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="head"><img src="img/xmas/sled.webp" alt=""><div><h2>雪山滑雪橇</h2><p>${esc(pet?.name ?? '夥伴')}坐上雪橇往山下衝，別被後面的雪崩追上！</p></div>
        <span class="snow-bal">${snow.SNOW}<b>${s?.balance ?? 0}</b></span></div>
      ${msg ?? ''}
      <ul class="how">
        <li><b>點一下</b>跳起來；在空中<b>按住</b>會後空翻，平穩落地就加速</li>
        <li>跳上<b>麋鹿</b>可以在空中多跳一次、<b>小北極熊</b>撞得開石頭、<b>大雪球</b>什麼都滾得過</li>
        <li>撿<b>雪花</b>和<b>禮物</b>；經過山腳小屋時禮物會丟進煙囪，多拿雪花</li>
        ${ab ? `<li class="ab">✨ ${esc(ab[1])}</li>` : ''}
      </ul>
      <p class="best">我的最遠紀錄：<b>${s?.ski?.best ?? 0}</b> 公尺・今天滑雪雪花 ${s?.today?.ski ?? 0}/${s?.caps?.ski ?? 12}</p>
      <div class="row end"><button type="button" class="btn" data-go>開始滑！</button></div>
    </div>`;
    $('[data-close]', veil).onclick = () => { close(); onClose?.(); };
    $('[data-go]', veil).onclick = play;
  }

  function play() {
    veil.innerHTML = `<canvas class="ski-cv"></canvas>
      <div class="ski-hud"><span>${snow.SNOW}<b data-n>0</b></span><span class="gift"><img src="img/xmas/ski-gift.webp" alt=""><b data-g>0</b></span><span><b data-d>0</b> 公尺</span></div>
      <p class="ski-tip">點一下跳，空中按住翻滾</p>
      <button class="x" data-quit aria-label="結束"></button>`;
    const cv = $('canvas', veil), ctx = cv.getContext('2d');
    let W = 0, H = 0;
    const fit = () => { const d = Math.min(2, devicePixelRatio || 1); W = veil.clientWidth; H = veil.clientHeight; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(d, 0, 0, d, 0, 0); };
    fit();
    addEventListener('resize', fit);
    // 地形：越往右越低（y 往下變大），加幾個波浪和跳台
    const seed = Math.random() * 1000;
    const hill = (x) => x * .36 + 70 * Math.sin((x + seed) / 330) + 34 * Math.sin((x + seed * 2) / 141 + 1) + ramp(x);
    function ramp(x) { const k = Math.floor(x / 1400), c = k * 1400 + 900; const d = x - c; return d > -160 && d < 0 ? -Math.pow((d + 160) / 160, 2) * 70 : 0; }
    const slope = (x) => (hill(x + 2) - hill(x - 2)) / 4;
    const P = { x: 0, y: hill(0), vx: 300, vy: 0, a: 0, ground: true, air: 0, spin: 0, mount: null, mountT: 0, stun: 0, boost: 0 };
    const S = { t: 0, snow: 0, gifts: 0, ax: -900, things: [], next: 500, over: false, holding: false, deliver: [] };
    const extraJumps = () => (P.mount === 'deer' ? 1 : 0) + (ab?.[0] === 'air' ? 1 : 0);
    // 路上的東西：石頭、坐騎、雪花（一串弧線）、禮物、小屋（裝飾＋送禮）
    function spawn(x) {
      const r = Math.random();
      if (r < .3) S.things.push({ k: 'rock', x, r: 26 });
      else if (r < .4) S.things.push({ k: ['deer', 'bear', 'ball'][Math.floor(Math.random() * 3)], x, r: 34 });
      else if (r < .75) { for (let i = 0; i < 5; i++) S.things.push({ k: 'snow', x: x + i * 46, lift: 60 + Math.sin(i / 4 * Math.PI) * 70, r: 18 }); }
      else S.things.push({ k: 'gift', x, lift: 40 + Math.random() * 80, r: 22 });
      if (Math.random() < .22) S.things.push({ k: 'house', x: x + 260, r: 0 });
      if (Math.random() < .5) S.things.push({ k: 'pine', x: x + 120 + Math.random() * 200, r: 0, bg: true });
    }
    function press(down) {
      if (S.over) return;
      S.holding = down;
      if (!down) return;
      if (P.ground) { P.vy = -620 - (P.mount === 'deer' ? 80 : 0); P.ground = false; P.air = extraJumps(); P.spin = 0; sfx('SE-02'); }
      else if (P.air > 0) { P.air -= 1; P.vy = -560; }
    }
    const down = (e) => { if (e.target.closest('[data-quit]')) return; e.preventDefault(); press(true); };
    const up = () => press(false);
    cv.addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    const key = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); press(e.type === 'keydown'); } };
    addEventListener('keydown', key);
    addEventListener('keyup', key);
    $('[data-quit]', veil).onclick = () => end();
    let last = performance.now();
    raf = requestAnimationFrame(step);

    function step(now) {
      const dt = Math.min(.033, (now - last) / 1000); last = now;
      if (!S.over) update(dt);
      draw();
      if (veil) raf = requestAnimationFrame(step);
    }
    function update(dt) {
      S.t += dt;
      const base = 300 + S.t * 6;                       // 越滑越快
      if (P.stun > 0) P.stun -= dt;
      if (P.boost > 0) P.boost -= dt;
      if (P.mount === 'ball' && (P.mountT -= dt) <= 0) P.mount = null;
      const want = (P.stun > 0 ? base * .45 : base) * (P.boost > 0 ? 1.45 : 1) * (P.mount === 'ball' ? 1.25 : 1);
      P.vx += (want - P.vx) * Math.min(1, dt * 2.2);
      P.x += P.vx * dt;
      if (P.ground) {
        P.y = hill(P.x);
        P.a = Math.atan(slope(P.x));
        // 跳台頂端會飛起來
        const s1 = slope(P.x), s0 = slope(P.x - P.vx * dt);
        if (s0 < -.2 && s1 > .1) { P.ground = false; P.vy = -P.vx * .9; P.air = extraJumps(); P.spin = 0; }
      } else {
        P.vy += 1500 * dt;
        P.y += P.vy * dt;
        if (S.holding) { P.a -= 7 * dt; P.spin += 7 * dt; } else P.a += (Math.atan(slope(P.x)) - P.a) * Math.min(1, dt * 3);
        if (P.y >= hill(P.x)) land();
      }
      // 雪崩：比基本速度慢一點，摔倒就會被追上
      S.ax += (base * .9 + S.t * 1.5) * dt;
      if (S.ax < P.x - 900) S.ax = P.x - 900;
      if (S.ax + 120 >= P.x) { end(); return; }
      while (S.next < P.x + W * 1.5) { spawn(S.next); S.next += 260 + Math.random() * 260; }
      const mag = ab?.[0] === 'magnet' ? 70 : 40;
      for (const o of S.things) {
        if (o.gone || o.bg || o.k === 'house') {
          if (o.k === 'house' && !o.done && P.x > o.x) { o.done = true; if (S.gifts) { S.snow += S.gifts; S.deliver.push({ x: o.x, y: hill(o.x) - 120, n: S.gifts, t: 1.4 }); S.gifts = 0; sfx('SE-20'); } }
          continue;
        }
        const oy = hill(o.x) - (o.lift ?? 0) - (o.k === 'rock' ? 10 : o.r);
        const d = Math.hypot(o.x - P.x, oy - (P.y - 30));
        if (o.k === 'snow' && d < mag) { o.gone = true; S.snow += 1; sfx('SE-01'); }
        else if (o.k === 'gift' && d < 46) { o.gone = true; S.gifts += 1; sfx('SE-01'); }
        else if (['deer', 'bear', 'ball'].includes(o.k) && d < 50) { o.gone = true; P.mount = o.k; P.mountT = 6; }
        else if (o.k === 'rock' && d < 38 && P.y > oy - 30) {
          o.gone = true;
          if (P.mount === 'bear' || P.mount === 'ball' || ab?.[0] === 'rock') { sfx('SE-02'); }
          else tumble();
        }
      }
      S.things = S.things.filter((o) => o.x > S.ax - 300);
      S.deliver.forEach((d) => { d.t -= dt; d.y -= 30 * dt; });
      S.deliver = S.deliver.filter((d) => d.t > 0);
      $('[data-n]', veil).textContent = S.snow;
      $('[data-g]', veil).textContent = S.gifts;
      $('[data-d]', veil).textContent = dist();
    }
    function land() {
      P.y = hill(P.x); P.ground = true; P.vy = 0;
      const sa = Math.atan(slope(P.x));
      let diff = (P.a - sa) % (Math.PI * 2); if (diff > Math.PI) diff -= Math.PI * 2; if (diff < -Math.PI) diff += Math.PI * 2;
      const flips = Math.floor((P.spin + .6) / (Math.PI * 2));
      P.a = sa;
      if (Math.abs(diff) > .8) { if (P.mount && P.mount !== 'ball') P.mount = null; else tumble(); return; }
      if (flips > 0) { P.boost = 1.2 + flips * 1.3; S.deliver.push({ x: P.x, y: P.y - 110, n: 0, t: 1.1, text: flips > 1 ? `${flips} 圈！加速！` : '後空翻！加速！' }); sfx('SE-20'); }
    }
    function tumble() { if (P.stun > 0) return; P.stun = 1; P.boost = 0; sfx('SE-02'); }
    const dist = () => Math.max(0, Math.round(P.x / 20));

    function draw() {
      const camX = P.x - W * .32, camY = P.y - H * .5;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#22346b'); g.addColorStop(1, '#8fb4e6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 遠山（視差）
      ctx.fillStyle = '#c9dbf3';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) { const wx = x + camX * .2; ctx.lineTo(x, H * .55 + 60 * Math.sin(wx / 230) + 30 * Math.sin(wx / 97)); }
      ctx.lineTo(W, H); ctx.fill();
      // 背景小松樹與小屋
      for (const o of S.things) if (o.k === 'pine' || o.k === 'house') sprite(o.k, o.x - camX, hill(o.x) - camY - 8, o.k === 'house' ? 120 : 80, 0, 1);
      // 雪坡
      ctx.beginPath(); ctx.moveTo(-10, H + 10);
      for (let x = -10; x <= W + 10; x += 8) ctx.lineTo(x, hill(x + camX) - camY);
      ctx.lineTo(W + 10, H + 10); ctx.closePath();
      const sg = ctx.createLinearGradient(0, H * .3, 0, H); sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#cfe2f7');
      ctx.fillStyle = sg; ctx.fill();
      ctx.strokeStyle = '#a9c8ec'; ctx.lineWidth = 3; ctx.stroke();
      // 東西
      for (const o of S.things) {
        if (o.gone || o.bg || o.k === 'house') continue;
        const x = o.x - camX, y = hill(o.x) - (o.lift ?? 0) - camY;
        if (o.k === 'snow') { if (imgs.snow) ctx.drawImage(imgs.snow, x - 15, y - 34 + Math.sin(S.t * 5 + o.x) * 3, 30, 30); }
        else if (o.k === 'gift') sprite('gift', x, y, 44, 0, 1);
        else if (o.k === 'rock') sprite('rock', x, y + 6, 64, Math.atan(slope(o.x)), 1);
        else sprite(o.k, x, y + 4, o.k === 'ball' ? 74 : 80, 0, 1);
      }
      // 自己
      const px = P.x - camX, py = P.y - camY;
      ctx.save(); ctx.translate(px, py); ctx.rotate(P.a);
      if (P.stun > 0 && Math.floor(S.t * 12) % 2) ctx.globalAlpha = .55;
      if (P.mount === 'ball') { ctx.save(); ctx.translate(0, -44); ctx.rotate(S.t * 6); sprite('ball', 0, 0, 92, 0, 1, true); ctx.restore(); }
      else if (P.mount) sprite(P.mount, 0, 4, 96, 0, 1);
      else sprite('sled', 0, 2, 96, 0, 1);
      const pi = P.ground ? imgs.pet : imgs.petJump;
      if (pi) { const h = 70, w = h * pi.width / pi.height; ctx.drawImage(pi, -w / 2 - 4, -h - (P.mount ? (P.mount === 'ball' ? 86 : 52) : 14), w, h); }
      ctx.restore();
      // 雪崩
      const wx = S.ax - camX;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(wx - 2000, -10, 2000 - 60, H + 20);
      sprite('wave', wx + 30, hill(S.ax) - camY + 40 + Math.sin(S.t * 3) * 6, 320, 0, 1);
      // 飄字
      ctx.font = '900 20px "Noto Sans TC", sans-serif'; ctx.textAlign = 'center';
      for (const d of S.deliver) {
        ctx.globalAlpha = Math.min(1, d.t); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1d3d7a'; ctx.lineWidth = 5;
        const t = d.text ?? `禮物送到了！雪花 +${d.n}`;
        ctx.strokeText(t, d.x - camX, d.y - camY); ctx.fillText(t, d.x - camX, d.y - camY);
      }
      ctx.globalAlpha = 1;
      // 雪崩靠近時畫面左邊變白提醒
      const gap = P.x - S.ax;
      if (gap < 360 && !S.over) { const a = (360 - gap) / 360 * .45; const lg = ctx.createLinearGradient(0, 0, W * .4, 0); lg.addColorStop(0, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W * .4, H); }
    }
    function sprite(k, x, y, w, rot, alpha, center = false) {
      const im = imgs[k]; if (!im) return;
      const h = w * im.height / im.width;
      ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot);
      ctx.drawImage(im, -w / 2, center ? -h / 2 : -h, w, h); ctx.restore();
    }
    async function end() {
      if (S.over) return;
      S.over = true;
      removeEventListener('pointerup', up); removeEventListener('keydown', key); removeEventListener('keyup', key); removeEventListener('resize', fit);
      const d = dist();
      let r = null, err = null;
      try { r = await auth.snow.ski(S.snow, d); snow.set(r); } catch (e) { err = e.message; }
      cancelAnimationFrame(raf);
      const s = snow.state();
      intro(`<div class="ski-result"><p class="big">滑了 <b>${d}</b> 公尺${r && d >= (r.best ?? 0) && d > 0 ? '・新紀錄！' : ''}</p>
        <p>撿到雪花 ${S.snow} 片${r ? `，拿到 <b>${r.got}</b> 片${r.got < S.snow ? `（今天滑雪最多 ${s?.caps?.ski ?? 12} 片）` : ''}` : ''}</p>
        ${err ? `<p class="note bad">${esc(err)}</p>` : ''}</div>`);
      $('[data-go]', veil).textContent = '再滑一次';
    }
  }
}
export function close() { cancelAnimationFrame(raf); veil?.remove(); veil = null; }
