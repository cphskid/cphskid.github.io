// 聖誕活動：雪山滑雪橇（2026-11-19 Chuck：玩法像 Ski Safari 那種無盡下坡，提案頁第二版 A）
// 自己的夥伴坐雪橇往下衝，沒有終點，後面雪崩越滾越快，被追上才結束；地形一段一段隨機接（緩坡、陡坡、小山丘、平地、跳台、斷崖、大波浪）。
//   點一下＝跳；在空中按住＝後空翻，平穩落地加速（翻越多圈加速越久）；落地歪掉會摔一下變慢。
//   2026-11-19 Chuck 要像 Ski Safari 的飛行：重力變輕、跳台斷崖加大、飛到最高點會停一下；
//   大冠鷲會把夥伴抓起來飛一段（按住往上拉、放開順著重力慢慢滑下來，角度跟著速度）；後空翻圈數決定加速的火焰（1 圈橘火、2 圈藍火、3 圈以上彩虹火，火燒著撞得碎石頭）。
//   同天晚上 Chuck：坐騎都要有速度加成、會跑；拿掉點兩下俯衝（照物理的加速度和角度）；撞石頭要有打擊感（頓一下、震動、碎片、被撞飛）。
//   坐騎：麋鹿（空中多跳一次）、小北極熊（撞開石頭）、大雪球（滾過一切，6 秒後散掉）。從坐騎摔下來不算輸，回到雪橇。
//   撿雪花、禮物；經過山腳小屋時禮物丟進煙囪，一個禮物多 1 片雪花。
//   夥伴本事：獨角獸、藍鵲多跳一次；小火龍撞石頭不會摔；小貓、石虎吸雪花範圍大。
// 一趟結束把撿到的雪花和距離送到 park_snow_ski_done（每天最多 12 片，伺服器算）。
import * as auth from './auth.js';
import * as snow from './snow.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPRITES = ['deer', 'bear', 'ball', 'rock', 'gift', 'house', 'pine', 'wave', 'sled', 'eagle'];
const ABILITY = {
  unicorn: ['air', '獨角獸：空中可以多跳一次'], magpie: ['air', '藍鵲：空中可以多跳一次'],
  dragon: ['rock', '小火龍：撞到石頭也不會摔'], kitten: ['magnet', '小貓：吸雪花的範圍比較大'], 'leopard-cat': ['magnet', '石虎：吸雪花的範圍比較大'],
};

let veil = null, raf = 0, imgs = {};
const EAGLE_TEST = /[?&]eagle=1/.test(location.search);   // 測試用：老鷹常常出現（tools/test/pet-preview.html?snow=1&eagle=1）
function load(src) { return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }

export async function openSki({ pet, onClose } = {}) {
  close();
  veil = document.createElement('div');
  veil.className = 'snow-veil ski';
  // iPhone 長按會跳出「拷貝／查詢／翻譯」：整個滑雪畫面不讓選字、不跳選單
  for (const ev of ['contextmenu', 'selectstart', 'dragstart']) veil.addEventListener(ev, (e) => e.preventDefault());
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
        <li><b>點一下</b>跳起來；在空中<b>按住</b>會後空翻，平穩落地就加速：翻 1 圈橘色火焰、2 圈藍色火焰、3 圈彩虹火焰，火燒著撞得碎石頭</li>
        <li>坐騎都跑得比雪橇快；看到<b>大冠鷲</b>就跳起來抓住牠：<b>按住</b>往上飛，<b>放開</b>慢慢滑下來，順著下坡落地會更快</li>
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
    // 地形：一段一段接下去，沒有終點。種類：緩坡、陡坡、小山丘連續起伏、平地、跳台、斷崖、大波浪；越滑越遠，陡坡和斷崖越多
    const STEP = 40, pts = [0];
    let segLeft = 0, seg = 'gentle', segN = 0, phase = 0;
    const TYPES = ['gentle', 'steep', 'moguls', 'flat', 'ramp', 'cliff', 'wave'];
    function pickSeg(x) {
      const far = Math.min(1, x / 40000);                 // 2 公里後最難
      const w = { gentle: 3 - far * 1.5, steep: 1 + far * 2, moguls: 1.5, flat: .8, ramp: 1.4, cliff: .3 + far * 1.5, wave: 1.2 };
      let r = Math.random() * TYPES.reduce((a, k) => a + w[k], 0);
      for (const k of TYPES) { r -= w[k]; if (r <= 0) return k; }
      return 'gentle';
    }
    function grow(upto) {
      while ((pts.length - 1) * STEP < upto) {
        const i = pts.length, x = i * STEP;
        if (segLeft <= 0) {
          seg = x < 800 ? 'gentle' : pickSeg(x);
          segN = { gentle: 14, steep: 10, moguls: 16, flat: 6, ramp: 8, cliff: 3, wave: 18 }[seg] + Math.floor(Math.random() * 6);
          segLeft = segN; phase = 0;
        }
        const k = segN - segLeft;                           // 這一段的第幾格
        let dy;
        if (seg === 'gentle') dy = .3;
        else if (seg === 'steep') dy = .75;
        else if (seg === 'flat') dy = .06;
        else if (seg === 'moguls') dy = .3 + Math.sin(k * STEP / 90 * Math.PI) * .55;
        else if (seg === 'wave') dy = .4 + Math.sin(k * STEP / 300 * Math.PI) * .7;
        else if (seg === 'ramp') dy = k < segN - 2 ? .1 - (k / segN) * 1.5 : 1.8;   // 往上翹，最後掉下去
        else dy = k === 1 ? 7 + Math.random() * 4 : .4;      // 斷崖：中間一格直直掉
        pts.push(pts[i - 1] + dy * STEP);
        segLeft -= 1;
      }
    }
    // 點和點之間用 Catmull-Rom 曲線接，坡度是連續的（以前用 cos 接，每 40px 坡度歸零一次，夥伴會一直抖）
    const hill = (x) => {
      if (x < 0) return x * .3;
      grow(x + STEP * 3);
      const i = Math.floor(x / STEP), t = x / STEP - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
      const t2 = t * t, t3 = t2 * t;
      return .5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    const slope = (x) => (hill(x + 2) - hill(x - 2)) / 4;
    const lean = (x) => Math.atan((hill(x + 24) - hill(x - 24)) / 48);   // 雪橇有長度：前後兩點連線的角度，比單點穩
    const P = { x: 0, y: hill(0), vx: 420, vy: 0, a: 0, ground: true, air: 0, spin: 0, mount: null, mountT: 0, stun: 0, boost: 0, fire: 0, hang: 0, dive: false, eagle: 0 };
    const S = { t: 0, snow: 0, gifts: 0, ax: -1200, things: [], next: 500, over: false, holding: false, holdT: 0, tapAt: -9, deliver: [] };
    const G = 1100;
    const MOUNT_SPEED = { deer: 1.22, bear: 1.12, ball: 1.35 };   // 坐騎都比雪橇快：麋鹿跑最快、大雪球滾更快、北極熊慢一點但撞得開石頭                                    // 重力（輕一點，飛得久，才翻得了好幾圈）
    const extraJumps = () => (P.mount === 'deer' ? 1 : 0) + (ab?.[0] === 'air' ? 1 : 0);
    // 路上的東西：石頭、坐騎、雪花（一串弧線）、禮物、小屋（裝飾＋送禮）
    function spawn(x) {
      const r = Math.random();
      if (r < .3) S.things.push({ k: 'rock', x, r: 26 });
      else if (r < .4) S.things.push({ k: ['deer', 'bear', 'ball'][Math.floor(Math.random() * 3)], x, r: 34 });
      else if (r < .75) { for (let i = 0; i < 5; i++) S.things.push({ k: 'snow', x: x + i * 46, lift: 60 + Math.sin(i / 4 * Math.PI) * 70, r: 18 }); }
      else S.things.push({ k: 'gift', x, lift: 40 + Math.random() * 80, r: 22 });
      if (x > (EAGLE_TEST ? 600 : 2500) && Math.random() < (EAGLE_TEST ? .7 : .09)) S.things.push({ k: 'eagle', x: x + 120, lift: 230 + Math.random() * 90, r: 60 });   // 大冠鷲：要跳起來才抓得到
      if (Math.random() < .22) S.things.push({ k: 'house', x: x + 260, r: 0 });
      if (Math.random() < .5) S.things.push({ k: 'pine', x: x + 120 + Math.random() * 200, r: 0, bg: true });
    }
    function press(down) {
      if (S.over) return;
      S.holding = down;
      if (!down) return;
      S.holdT = 0;
      if (P.eagle > 0 || P.knock) return;             // 老鷹上：按住就是往上拉（在 update 裡算）
      if (P.ground) { P.vy = -700 - (P.mount === 'deer' ? 90 : 0); P.ground = false; P.air = extraJumps(); P.spin = 0; sfx('SE-02'); return; }
      if (P.air > 0) { P.air -= 1; P.vy = -620; }
    }
    function release() { P.eagle = 0; P.air = extraJumps(); P.spin = 0; }
    const down = (e) => { if (e.target.closest('[data-quit]')) return; e.preventDefault(); press(true); };
    const up = () => press(false);
    cv.addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    const key = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); press(e.type === 'keydown'); } };
    addEventListener('keydown', key);
    addEventListener('keyup', key);
    $('[data-quit]', veil).onclick = () => end();
    // 固定步長 1/120 秒算物理，畫面用前後兩步插值：不管手機每秒幾格，動起來都一樣順
    const FIX = 1 / 120;
    let last = performance.now(), acc = 0, prev = { x: P.x, y: P.y, a: P.a };
    const C = { x: P.x, y: P.y, z: 1 };                 // 鏡頭：平滑跟著，速度越快拉越遠
    const fx = [];                                      // 雪花粒子、速度線
    raf = requestAnimationFrame(step);

    function step(now) {
      acc += Math.min(.1, (now - last) / 1000); last = now;
      while (acc >= FIX) {
        if (S.freeze > 0) { S.freeze -= FIX; acc -= FIX; continue; }   // 撞到的瞬間頓一下（打擊感）
        prev = { x: P.x, y: P.y, a: P.a }; if (!S.over) update(FIX); acc -= FIX;
      }
      const k = acc / FIX;
      draw({ x: prev.x + (P.x - prev.x) * k, y: prev.y + (P.y - prev.y) * k, a: prev.a + (P.a - prev.a) * k }, Math.min(.1, FIX + acc));
      if (veil) raf = requestAnimationFrame(step);
    }
    function update(dt) {
      S.t += dt;
      const base = 420 + Math.min(S.t, 120) * 5.4;         // 自己也越滑越快，但兩分鐘後就不會再快（雪崩會）
      if (P.stun > 0) P.stun -= dt;
      if (P.boost > 0 && (P.boost -= dt) <= 0) P.fire = 0;
      if (S.holding) S.holdT += dt;
      if (P.mount === 'ball' && (P.mountT -= dt) <= 0) P.mount = null;
      const want = (P.stun > 0 ? base * .45 : base) * (P.boost > 0 ? [1.4, 1.45, 1.62, 1.85][P.fire] : 1) * (P.eagle > 0 ? 1.45 : MOUNT_SPEED[P.mount] ?? 1);
      P.vx += (want - P.vx) * Math.min(1, dt * 2.2);
      P.x += P.vx * dt;
      if (P.eagle > 0) {
        // 被大冠鷲抓著：飛到坡上方 300 左右，沿路撿高空雪花；時間到放手
        // 按住：老鷹用力拍翅往上拉；放開：順著重力慢慢滑下來（角度跟著速度，越往下越快）
        P.eagle -= dt;
        if (S.holding) P.vy -= 1900 * dt; else P.vy += 520 * dt;
        P.vy = Math.max(-520, Math.min(700, P.vy));
        if (hill(P.x) - P.y > 480 && P.vy < 0) P.vy *= .9;          // 不會飛出天際
        P.y += P.vy * dt;
        P.vx += Math.max(0, P.vy) * .25 * dt;                         // 往下滑會加速
        P.a += (Math.atan2(P.vy, P.vx) * .8 - P.a) * Math.min(1, dt * 6);
        if (P.y >= hill(P.x)) { release(); land(); }
        else if (P.eagle <= 0) release();
      } else if (P.ground) {
        P.y = hill(P.x);
        P.a += (lean(P.x) - P.a) * Math.min(1, dt * 14);   // 角度慢慢轉過去，不會一格一格跳
        // 跳台頂端會飛起來
        const s1 = slope(P.x), s0 = slope(P.x - P.vx * dt);
        if (s0 < -.2 && s1 > .1) { P.ground = false; P.vy = -P.vx * .75; P.air = extraJumps(); P.spin = 0; }
        else if (slope(P.x + 20) > 2.2) { P.ground = false; P.vy = 0; P.air = extraJumps(); P.spin = 0; }   // 斷崖：直接飛出去
        else {
          // 衝過坡頂太快會自然飛起來（重力拉不住），不會硬貼著地面一頓一頓
          const curv = (slope(P.x + 6) - slope(P.x - 6)) / 12;
          if (curv > 0 && P.vx * P.vx * curv > G * 1.15) { P.ground = false; P.vy = P.vx * s1; P.air = extraJumps(); P.spin = 0; }
        }
      } else {
        // 飛到最高點停一下（夠高才停）
        const was = P.vy;
        if (P.hang > 0) P.hang -= dt;
        P.vy += G * dt * (P.hang > 0 ? .15 : 1);
        if (was < 0 && P.vy >= 0 && !P.knock && hill(P.x) - P.y > 140) P.hang = .3;
        P.y += P.vy * dt;
        if (P.knock) P.a += 13 * dt;                                       // 被石頭撞飛：往前翻滾
        else if (S.holding && S.holdT > .1) { P.a -= 7 * dt; P.spin += 7 * dt; }
        else {
          // 放開：停在當下的角度（不會反方向轉回去）；只有快要正的時候才輕輕扶正，落地角度要自己抓
          let d = (lean(P.x) - P.a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) < .6) P.a += d * Math.min(1, dt * 3);
        }
        if (P.y >= hill(P.x)) land();
      }
      // 雪崩：比基本速度慢一點，摔倒就會被追上
      S.ax += (285 + S.t * 9.4) * dt;                     // 雪崩越滾越快，總有一天追上來；後空翻加速、騎坐騎才甩得開
      if (S.ax < P.x - 1200) S.ax = P.x - 1200;
      if (S.ax + 120 >= P.x) { end(); return; }
      // 加速火焰：拖在雪橇後面
      if (P.boost > 0 && P.fire) for (let i = 0; i < 2; i++) fx.push({ k: 'fire', lv: P.fire, x: P.x - 34 + (Math.random() - .5) * 10, y: P.y - 20 + (Math.random() - .5) * 26, vx: -90 - Math.random() * 120, vy: -30 - Math.random() * 60, t: .45 + Math.random() * .2, t0: .65, r: 9 + Math.random() * 8, h: Math.random() * 360 });
      // 雪橇噴雪：越快噴越多
      if (P.ground && Math.random() < Math.min(1, P.vx / 500)) fx.push({ k: 'puff', x: P.x - 30, y: P.y - 4, vx: -60 - Math.random() * 80, vy: -80 - Math.random() * 120, t: .5 + Math.random() * .3, r: 3 + Math.random() * 4 });
      while (S.next < P.x + W * 2.2) { spawn(S.next); S.next += 260 + Math.random() * 260; }
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
        else if (o.k === 'eagle' && d < 70 && !P.ground && P.eagle <= 0) { o.gone = true; P.eagle = 4; P.eagle = 5; P.mount = null; P.hang = 0; P.vy = Math.min(P.vy, -200); sfx('SE-20');
          for (let i = 0; i < 12; i++) S.things.push({ k: 'snow', x: P.x + 300 + i * 70, lift: 300 + Math.sin(i / 3) * 40, r: 18 });
          S.deliver.push({ x: P.x, y: P.y - 140, n: 0, t: 1.6, text: '大冠鷲！按住往上飛' }); }
        else if (['deer', 'bear', 'ball'].includes(o.k) && d < 50 && P.eagle <= 0) { o.gone = true; P.mount = o.k; P.mountT = 6; sfx('SE-20'); S.deliver.push({ x: P.x, y: P.y - 130, n: 0, t: 1, text: { deer: '騎上麋鹿！', bear: '騎上北極熊！', ball: '大雪球！' }[o.k] }); }
        else if (o.k === 'rock' && d < 38 && P.y > oy - 30) {
          o.gone = true;
          const smash = P.mount === 'bear' || P.mount === 'ball' || ab?.[0] === 'rock' || (P.boost > 0 && P.fire);
          shards(o.x, oy, smash ? 14 : 9);
          if (smash) { sfx('SE-02'); S.freeze = .05; S.shake = .25; S.deliver.push({ x: o.x, y: oy - 60, n: 0, t: .7, text: '碎！', big: true }); }
          else knock(o.x, oy);
        }
      }
      S.things = S.things.filter((o) => o.x > S.ax - 300);
      S.deliver.forEach((d) => { d.t -= dt; d.y -= 30 * dt; });
      S.deliver = S.deliver.filter((d) => d.t > 0);
      if ((S.hud = (S.hud ?? 0) + 1) % 6 === 0) {
        $('[data-n]', veil).textContent = S.snow;
        $('[data-g]', veil).textContent = S.gifts;
        $('[data-d]', veil).textContent = dist();
      }
    }
    function land() {
      const landVy = P.vy;
      P.y = hill(P.x); P.ground = true; P.vy = 0;
      const sa = Math.atan(slope(P.x));
      let diff = (P.a - sa) % (Math.PI * 2); if (diff > Math.PI) diff -= Math.PI * 2; if (diff < -Math.PI) diff += Math.PI * 2;
      const flips = Math.floor((P.spin + .6) / (Math.PI * 2));
      P.a = lean(P.x);
      fx.push(...Array.from({ length: 10 }, () => ({ k: 'puff', x: P.x + (Math.random() - .5) * 60, y: P.y - 4, vx: (Math.random() - .3) * 160, vy: -60 - Math.random() * 160, t: .6, r: 4 + Math.random() * 5 })));
      P.hang = 0;
      if (P.knock) { P.knock = false; P.a = lean(P.x); P.spin = 0; return; }   // 被撞飛的落地：不算摔第二次
      // 順著坡平穩落地、而且是從高處衝下來：速度帶進去（像 Ski Safari 落在下坡會加速）
      const fall = Math.max(0, landVy);
      if (Math.abs(diff) <= 1 && sa > .15 && fall > 500) { P.vx += Math.min(260, fall * sa * .35); S.deliver.push({ x: P.x, y: P.y - 90, n: 0, t: .8, text: '漂亮落地！' }); }
      if (Math.abs(diff) > 1) { if (P.mount && P.mount !== 'ball') P.mount = null; else tumble(); return; }
      if (flips > 0) {
        // 翻越多圈火越旺：1 圈橘火、2 圈藍火、3 圈以上彩虹火（火燒著撞得碎石頭）
        P.fire = Math.max(P.fire, Math.min(3, flips)); P.boost = 1.4 + flips * 1.4;
        S.deliver.push({ x: P.x, y: P.y - 110, n: 0, t: 1.1, text: ['', '後空翻！橘色火焰！', '2 圈！藍色火焰！', `${flips} 圈！彩虹火焰！`][Math.min(3, flips)] }); sfx('SE-20');
      }
    }
    function tumble() { if (P.stun > 0) return; P.stun = 1; P.boost = 0; P.fire = 0; S.shake = .3; sfx('SE-02'); }
    // 撞到石頭：頓一下、畫面震、閃白、夥伴被撞飛翻一圈、速度掉一大截
    function knock(x, y) {
      if (P.stun > 0) return;
      if (P.mount && P.mount !== 'ball') P.mount = null;
      S.freeze = .12; S.shake = .45; S.flash = .15;
      P.stun = 1.1; P.boost = 0; P.fire = 0; P.vx *= .55;
      P.ground = false; P.knock = true; P.vy = -480; P.hang = 0; P.eagle = 0;
      S.deliver.push({ x, y: y - 70, n: 0, t: .9, text: '砰！', big: true });
      sfx('SE-02');
    }
    function shards(x, y, n) {
      for (let i = 0; i < n; i++) fx.push({ k: 'shard', x, y, vx: 60 + Math.random() * 380, vy: -200 - Math.random() * 320, t: .8 + Math.random() * .3, r: 5 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - .5) * 18 });
      for (let i = 0; i < 8; i++) fx.push({ k: 'puff', x: x + (Math.random() - .5) * 30, y, vx: (Math.random() - .3) * 260, vy: -100 - Math.random() * 200, t: .5, r: 5 + Math.random() * 6 });
    }
    const dist = () => Math.max(0, Math.round(P.x / 20));

    function draw(R, fdt) {
      const sp = Math.max(0, (P.vx - 420) / 700);       // 0～1：多快
      // 鏡頭：越快拉越遠、越往前看；跟得上但不會跟著每個小起伏上下抖
      // 飛很高的時候也拉遠，看得到底下的坡；鏡頭對準夥伴和地面中間
      const airH = Math.max(0, hill(R.x + 120) - R.y);
      C.z += ((1 - Math.min(.28, sp * .3) - Math.min(.4, airH / 1200)) * Math.min(1, W / 700 + .25) - C.z) * Math.min(1, fdt * 2);
      const VW = W / C.z, VH = H / C.z;
      C.x = R.x;
      // 夥伴（加上頭上的老鷹）要留在畫面中間偏上，地面在下面；往上衝時鏡頭先往前看一點，不會跟丟
      const ty = P.ground ? R.y - VH * .52 : R.y - VH * .46 + Math.min(airH * .3, VH * .1) + Math.min(0, P.vy) * .18;
      C.y += (ty - C.y) * Math.min(1, fdt * (Math.abs(ty - C.y) > VH * .3 ? 12 : 6));
      const camX = C.x - VW * (.3 - sp * .06), camY = C.y;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#22346b'); g.addColorStop(1, '#8fb4e6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (S.shake > 0) { S.shake -= fdt; const m = Math.min(1, S.shake * 3) * 14; ctx.translate((Math.random() - .5) * m, (Math.random() - .5) * m); }
      ctx.scale(C.z, C.z);
      const H0 = H; { const W = VW, H = VH; // 下面都用鏡頭看到的寬高
      // 遠山（視差）
      ctx.fillStyle = '#c9dbf3';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 20; x += 20) { const wx = x + camX * .2; ctx.lineTo(x, H * .55 + 60 * Math.sin(wx / 230) + 30 * Math.sin(wx / 97)); }
      ctx.lineTo(W + 20, H); ctx.fill();
      // 中景的雪丘和松樹影子（跑得比遠山快，速度感）
      ctx.fillStyle = '#b3cbec';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 20; x += 16) { const wx = x + camX * .5; ctx.lineTo(x, H * .7 + 40 * Math.sin(wx / 170) + 18 * Math.sin(wx / 61)); }
      ctx.lineTo(W + 20, H); ctx.fill();
      ctx.fillStyle = '#93b2dc';
      for (let i = Math.floor(camX * .5 / 140) - 1; i * 140 < camX * .5 + W + 140; i++) {
        const x = i * 140 - camX * .5 + ((i * 53) % 60), b = H * .7 + 40 * Math.sin((x + camX * .5) / 170) + 18 * Math.sin((x + camX * .5) / 61) + 6, h = 50 + ((i * 37) % 40);
        ctx.beginPath(); ctx.moveTo(x, b - h); ctx.lineTo(x + h * .32, b); ctx.lineTo(x - h * .32, b); ctx.fill();
      }
      // 背景小松樹與小屋
      // 小屋和松樹種在坡上：底部對齊左右兩邊比較低的那點，再往下埋一點，前面的雪坡會蓋住底部（不會飄在空中）
      for (const o of S.things) if (o.k === 'pine' || o.k === 'house') {
        const w = o.k === 'house' ? 120 : 80, base = Math.max(hill(o.x - w * .4), hill(o.x + w * .4));
        sprite(o.k, o.x - camX, base - camY + w * (o.k === 'house' ? .14 : .1), w, 0, 1);
      }
      // 雪坡
      // 取樣點對齊世界座標（不跟著鏡頭小數點移動），坡的邊線才不會閃
      ctx.beginPath(); ctx.moveTo(-10, H + 10);
      for (let wx = Math.floor(camX / 6) * 6 - 6; wx <= camX + W + 12; wx += 6) ctx.lineTo(wx - camX, hill(wx) - camY);
      ctx.lineTo(W + 12, H + 10); ctx.closePath();
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
        else if (o.k === 'eagle') eagle(x + Math.sin(S.t * 2 + o.x) * 20, y + 30 + Math.sin(S.t * 3 + o.x) * 12, 120);
        else sprite(o.k, x, y + 4, o.k === 'ball' ? 74 : 80, 0, 1);
      }
      // 自己
      // 雪花粒子
      for (const f of fx) { f.t -= fdt; f.x += f.vx * fdt; f.y += f.vy * fdt; f.vy += 400 * fdt; }
      for (let i = fx.length - 1; i >= 0; i--) if (fx[i].t <= 0) fx.splice(i, 1);
      for (const f of fx) {
        if (f.k === 'fire') continue;
        if (f.k === 'shard') {
          f.rot += f.vr * fdt; ctx.save(); ctx.translate(f.x - camX, f.y - camY); ctx.rotate(f.rot); ctx.globalAlpha = Math.min(1, f.t * 2);
          ctx.fillStyle = '#7d8796'; ctx.beginPath(); ctx.moveTo(-f.r, -f.r * .6); ctx.lineTo(f.r * .8, -f.r); ctx.lineTo(f.r, f.r * .5); ctx.lineTo(-f.r * .4, f.r); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#eef4fb'; ctx.fillRect(-f.r * .6, -f.r * .8, f.r * .9, f.r * .35); ctx.restore(); continue;
        }
        ctx.fillStyle = f.c ?? '#ffffff'; ctx.globalAlpha = Math.min(1, f.t * 2); ctx.beginPath(); ctx.arc(f.x - camX, f.y - camY, f.r, 0, 7); ctx.fill();
      }
      // 火焰：疊亮色，越新的越大越亮
      ctx.globalCompositeOperation = 'lighter';
      for (const f of fx) {
        if (f.k !== 'fire') continue;
        const k = f.t / f.t0, r = f.r * (.5 + k * .8), x = f.x - camX, y = f.y - camY;
        const [c1, c2] = f.lv === 1 ? ['255,236,140', '255,110,20'] : f.lv === 2 ? ['210,250,255', '40,130,255'] : [`255,255,255`, hsl(f.h + S.t * 400)];
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${c1},${k})`); gr.addColorStop(.45, `rgba(${c2},${k * .8})`); gr.addColorStop(1, `rgba(${c2},0)`);
        ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const px = R.x - camX, py = R.y - camY;
      ctx.save(); ctx.translate(px, py); ctx.rotate(R.a);
      if (P.stun > 0 && Math.floor(S.t * 12) % 2) ctx.globalAlpha = .55;
      // 坐騎在地上會跑：一跳一跳（麋鹿步子大、北極熊短短快快），身體前後搖
      const run = P.ground && (P.mount === 'deer' || P.mount === 'bear');
      const gait = run ? S.t * (P.mount === 'deer' ? 11 : 15) : 0, bob = run ? -Math.abs(Math.sin(gait)) * (P.mount === 'deer' ? 14 : 8) : 0;
      if (run) { ctx.translate(0, bob); ctx.rotate(Math.cos(gait) * .08); }
      if (P.mount === 'ball') { ctx.save(); ctx.translate(0, -44); ctx.rotate(S.t * (6 + P.vx / 120)); sprite('ball', 0, 0, 92, 0, 1, true); ctx.restore(); }
      else if (P.mount) { sprite(P.mount, 0, 4, 96, 0, 1); if (run && Math.sin(gait) > .9) fx.push({ k: 'puff', x: R.x - 20, y: R.y - 2, vx: -120, vy: -90, t: .4, r: 5 }); }
      else sprite('sled', 0, 2, 96, 0, 1);
      const pi = P.ground ? imgs.pet : imgs.petJump;
      if (pi) { const h = 70, w = h * pi.width / pi.height; ctx.drawImage(pi, -w / 2 - 4, -h - (P.mount ? (P.mount === 'ball' ? 86 : 52) : 14), w, h); }
      if (P.eagle > 0) eagle(0, -(P.mount ? 120 : 84), 150);       // 抓著夥伴的大冠鷲
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
        ctx.font = d.big ? `900 ${Math.round(34 + (1 - Math.min(1, d.t)) * 10)}px "Noto Sans TC", sans-serif` : '900 20px "Noto Sans TC", sans-serif';
        ctx.strokeText(t, d.x - camX, d.y - camY); ctx.fillText(t, d.x - camX, d.y - camY);
      }
      ctx.globalAlpha = 1;
      } ctx.restore();
      const W0 = W; { const H = H0, W = W0;
      if (S.flash > 0) { S.flash -= fdt; ctx.fillStyle = `rgba(255,255,255,${Math.min(.6, S.flash * 4)})`; ctx.fillRect(0, 0, W, H); }
      // 速度線：快的時候畫面上飛過的白線
      if (sp > .08) {
        ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
        for (let i = 0; i < 14; i++) {
          const seed = i * 977, y = (seed % 1000) / 1000 * H, len = 60 + sp * 160 + (seed % 70);
          const x = W - ((S.t * (900 + sp * 1400) + seed * 3) % (W + len * 2));
          ctx.globalAlpha = Math.min(.55, sp * .7) * (.5 + (i % 3) * .25); ctx.lineWidth = 2 + (i % 3);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - len * .12); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // 雪崩靠近時畫面左邊變白提醒
      const gap = P.x - S.ax;
      if (gap < 360 && !S.over) { const a = (360 - gap) / 360 * .45; const lg = ctx.createLinearGradient(0, 0, W * .4, 0); lg.addColorStop(0, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W * .4, H); }
      }
    }
    // 大冠鷲：翅膀上下拍（垂直壓扁一點點）
    function eagle(x, y, w) {
      const im = imgs.eagle; if (!im) return;
      const h = w * im.height / im.width, f = 1 + Math.sin(S.t * 14) * .12;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, f); ctx.drawImage(im, -w / 2, -h * .75, w, h); ctx.restore();
    }
    const hsl = (h) => { const c = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (.5 - .5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return `${c(0)},${c(8)},${c(4)}`; };
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
