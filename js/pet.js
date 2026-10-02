// 主島桌寵（資料庫在 supabase/park_pet.sql；規劃書「主島桌寵系統規劃」）。
//
// 地圖：寵物島上，所有夥伴縮小了在走來走去；照顧中的那隻餓了、生氣頭上會冒符號。還沒領養時島上是一顆時光蛋。
// 寵物島（點島打開的全畫面場景）：夥伴們在島上自己走、玩、打瞌睡，可以拎起來放到別的地方。
//   點一隻看牠的狀態；一次只照顧一隻（餵食、摸摸、會餓、會長大），其他的在島上自給自足。
//   餵食：碗出現在旁邊，牠走過去慢慢吃完。
//   護照章 3 個、6 個各多一顆時光蛋，可以再領養一隻。
// 規則（會不會餓、能不能吃、長大）全部由資料庫判斷，這裡只負責畫出來和講話。
// 之後的傢俱擺放沿用同一套拎起／放下（actors）。
import * as auth from './auth.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

const STAGE = ['', '幼年', '成長期', '完全體'];
const MOOD = { normal: '心情不錯', happy: '超開心', hungry: '肚子餓了', angry: '在生氣', asleep: '睡著了', island: '在島上玩' };
const LINES = {
  normal: ['今天要去哪座島冒險？', '摸摸我嘛！', '這座島好好玩！', '外面的島好像很好玩！'],
  happy:  ['最喜歡你了！', '嘿嘿，好舒服～', '今天也一起加油！'],
  hungry: ['肚子好餓…有沒有吃的？', '咕嚕咕嚕…我餓了啦'],
  angry:  ['哼！我不理你了！', '你都不餵我…（氣噗噗）'],
  sulky:  ['哼…吃飽了，可是我還在生氣，摸摸我才原諒你'],
  asleep: ['Zzz…（摸摸牠叫醒牠）'],
  quiet:  ['上課中，我先睡一下，放學見！'],
  island: ['我在島上玩得很開心！', '這裡有好多好玩的東西～', '湖邊好涼快！'],
};

let api = auth.pet;
// host：放地圖小東西的圖層；island：寵物島在地圖上的位置 {left, top, width}
let hooks = { me: () => ({ kind: 'guest' }), host: () => null, island: () => null, dragged: () => false, onChange: () => {} };
let state = null;            // park_pet_me() 的結果；null＝不是學生或資料庫還沒裝
let news = [];               // 剛拿到的道具（顯示一次）

const layer = $('#petroom');

// api：測試頁可以換成假的（tools/test/pet-preview.html）
export function init(h) {
  if (h.api) api = h.api;
  hooks = { ...hooks, ...h };
}

const myPet = () => state?.pets?.find((p) => p.active) ?? null;
const petById = (id) => state?.pets?.find((p) => p.id === id) ?? null;
const speciesName = (code) => state?.species?.find((s) => s.code === code)?.name ?? '';
const item = (code) => state?.items?.find((i) => i.code === code);
// 圖：img/pet/<種類>/<階段>-<動作>.webp（PT 系列動作表切出來的）
const art = (species, stage = 1, pose = 'idle') => `img/pet/${esc(species)}/${stage}-${pose}.webp`;
const POSE = { normal: 'idle', happy: 'cheer', hungry: 'hungry', angry: 'angry', asleep: 'sleep', quiet: 'sleep', island: 'idle' };
const FOOD_IMG = new Set(['kibble', 'rice-ball', 'magic-fruit']);           // 有 PT-10 圖的道具，其他先用表情符號
const icon = (i) => FOOD_IMG.has(i.code) ? `<img src="img/pet/food/${esc(i.code)}.webp" alt="">` : esc(i.icon);
const owned = (code) => state?.pets?.some((p) => p.species === code);
const freeStarters = () => (state?.species ?? []).filter((s) => s.starter && !owned(s.code));
const canAdopt = () => !!state && state.pets.length < (state.slots ?? 1) && freeStarters().length > 0;
function moodOf(p) {
  if (!p.active) return 'island';
  if (state?.quiet) return 'quiet';
  return p.mood;
}
const MARK = { hungry: '!', angry: '💢', asleep: 'Zz', quiet: 'Zz', happy: '♥' };

// ---------- 讀資料 ----------
export async function load() {
  const w = hooks.me();
  if (w.kind !== 'student') { state = null; paintMap(); return null; }
  try {
    state = await api.me();
  } catch {
    state = null;               // 資料庫還沒裝或連不上：地圖上就不出現桌寵
  }
  if (state?.granted?.length) news = state.granted;
  paintMap();
  return state;
}

// 地圖上要提醒的事：餓了、生氣、拿到新東西（滴答打招呼時會用）
export function notice() {
  const p = myPet();
  if (!state) return null;
  if (!p) return '寵物島上有一顆會發光的時光蛋，點點看！';
  if (state.quiet) return null;
  if (p.mood === 'asleep') return `${p.name}在寵物島睡著了，去叫醒牠吧！`;
  if (p.mood === 'angry') return `${p.name}好像在生氣，快去寵物島餵牠吃東西！`;
  if (p.mood === 'hungry') return `${p.name}肚子餓了，去寵物島餵牠吧！`;
  if (news.length) return `${p.name}收到新的點心了，去寵物島看看！`;
  return null;
}

// ---------- 地圖：寵物島上縮小的夥伴（或一顆時光蛋） ----------
function paintMap() {
  $('#map-pet')?.remove();
  const host = hooks.host();
  const spot = hooks.island();
  let box = $('#isle-pets');
  if (!host || !spot || !state) { box?.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'isle-pets';
    host.appendChild(box);
  }
  box.style.cssText = `left:${spot.left + spot.width * .42}px;top:${spot.top + spot.width * .27}px;width:${spot.width * .4}px`;   // 草原那一塊
  const pets = state.pets;
  if (!pets.length) {
    box.innerHTML = `<button type="button" class="mini egg-wait" aria-label="時光蛋：領養你的桌寵"><span class="egg"></span><img class="glint" src="img/fx/sparkle.webp" alt=""></button>`;
  } else {
    box.innerHTML = pets.map((p, i) => {
      const m = moodOf(p);
      const still = ['asleep', 'quiet', 'angry'].includes(m);
      const mark = p.active ? (MARK[m] ?? (news.length ? '🎁' : '')) : '';
      return `<button type="button" class="mini${still ? ' still' : ''}${p.active ? ' care' : ''}" style="--i:${i};--dist:${Math.round(spot.width * (.1 + .04 * i))}px;left:${i * 24}%;top:${(i % 2) * 14}px"
        aria-label="${esc(p.name)}${p.active ? `（${m === 'quiet' ? '上課時間在休息' : MOOD[m]}）` : '在寵物島上散步'}">${mark ? `<span class="mp-bub">${mark}</span>` : ''}${still
          ? `<img src="${art(p.species, p.stage, POSE[m])}" alt="">`
          : `<img src="${art(p.species, p.stage, 'walk1')}" alt=""><img class="w2" src="${art(p.species, p.stage, 'walk2')}" alt="">`}</button>`;
    }).join('');
  }
  box.querySelectorAll('.mini').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); if (!hooks.dragged?.()) open(); }; });
}

// ---------- 外框 ----------
function show(html) {
  // 已經開著時只換內容，不再跳一次彈出動畫（不然每按一下整個視窗會閃）
  layer.classList.toggle('again', !layer.hidden);
  stopScene();
  layer.innerHTML = html;
  layer.hidden = false;
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
export function close() {
  if (layer.hidden) return;
  stopScene();
  layer.hidden = true;
  layer.innerHTML = '';
  news = [];
  paintMap();
  hooks.onChange(state);
}
layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function problem(msg) {
  show(`<div class="den small" role="dialog" aria-modal="true" aria-label="桌寵">
    <button class="x" data-close aria-label="關閉"></button>
    <img class="tick" src="img/tick/thinking.webp" alt="">
    <div><h2>寵物島還在蓋</h2><p class="lead">${esc(msg)}</p>
    <div class="row"><button class="btn small" data-close>好</button></div></div></div>`);
}

export async function open() {
  if (hooks.me().kind !== 'student') return;
  if (!state) {
    try { state = await api.me(); } catch (e) { problem(e.missing ? '夥伴們很快就會搬進寵物島，再等一下下！' : e.message); return; }
  }
  if (!state.pets.length) return openAdopt();
  openScene();
}
export const openIsland = open;

// ---------- 領養：選一隻（或隨機）→ 取名 → 孵蛋 ----------
// more：從寵物島來的（已經有夥伴，新領養的住到島上）
function openAdopt({ more = false } = {}) {
  let choice = null;
  const starters = freeStarters();
  const paint = () => {
    const cards = starters.map((s) => `<button type="button" class="pal${choice === s.code ? ' on' : ''}" data-sp="${esc(s.code)}">
        <img src="${art(s.code)}" alt=""><b>${esc(s.name)}</b></button>`).join('')
      + `<button type="button" class="pal rnd${choice === 'random' ? ' on' : ''}" data-sp="random">
        <span class="egg"></span><b>隨機</b><small>孵出來才知道！</small></button>`;
    const intro = more ? '你蓋了好多護照章，又得到一顆時光蛋！孵出來的新夥伴也會住在寵物島上。'
                       : '這是一顆時光蛋！選一隻想要的夥伴，牠會住在寵物島陪你冒險。';
    show(`<div class="den adopt" role="dialog" aria-modal="true" aria-label="領養桌寵">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="say"><img src="img/tick/excited.webp" alt="滴答"><p>${intro}</p></div>
      <div class="pals" style="--n:${starters.length + 1}">${cards}</div>
      <form class="name" novalidate>
        <label>幫牠取名字<input name="n" maxlength="8" autocomplete="off" placeholder="${choice && choice !== 'random' ? esc(speciesName(choice)) : '可以不填'}"></label>
        <button class="btn go" type="submit" ${choice ? '' : 'disabled'}>孵出來吧！</button>
      </form>
      <p class="msg" hidden></p></div>`);
    layer.querySelectorAll('[data-sp]').forEach((b) => { b.onclick = () => { const n = $('input', layer).value; choice = b.dataset.sp; paint(); $('input', layer).value = n; }; });
    $('form', layer).onsubmit = async (e) => {
      e.preventDefault();
      if (!choice) return;
      const b = $('button[type=submit]', layer);
      b.disabled = true;
      try {
        const s = await api.adopt(choice, $('input', layer).value.trim());
        hatch(s);
      } catch (err) {
        const msg = $('.msg', layer);
        msg.textContent = err.message; msg.hidden = false;
        b.disabled = false;
      }
    };
  };
  paint();
}

function hatch(s) {
  state = { ...state, ...s, granted: [] };
  const p = state.pets.find((x) => x.species === s.adopted) ?? myPet();
  show(`<div class="den hatch" role="dialog" aria-modal="true" aria-label="孵蛋">
    <div class="egg big"></div><img class="pop" src="${art(p.species, 1, 'cheer')}" alt="">
    <p>${esc(p.name)}孵出來了！</p></div>`);
  setTimeout(() => {
    paintMap();
    openScene({ select: p.id, say: p.active ? `你好！我是${p.name}，以後請多多指教！` : `我是${p.name}！我先在島上玩，想照顧我就按「換牠照顧」。` });
  }, 2300);
}

// ---------- 照顧面板用的小零件 ----------
function wish() {
  const inv = state.inventory ?? {};
  const want = state.items.filter((i) => i.kind === 'special' && !inv[i.code] && i.facility_name);
  if (!want.length) return '';
  const w = want[Math.floor(Date.now() / 3.6e6) % want.length];      // 每小時換一個想吃的
  return `<div class="wish"><span>${icon(w)}</span><p>我好想吃<b>${esc(w.name)}</b>！在「${esc(w.facility_name)}」完成任務就拿得到喔。</p></div>`;
}
function newsHtml() {
  if (!news.length) return '';
  const t = news.map((g) => {
    const i = item(g.item);
    if (g.source === 'daily') return `今天的 ${g.qty} 份${esc(i?.name ?? '飼料')}送到了`;
    return `在「${esc(i?.facility_name ?? '島上')}」蓋了章，拿到${esc(i?.name ?? '點心')}`;
  });
  return `<div class="gotnew"><img src="img/fx/sparkle.webp" alt=""><p>${t.join('；')}！</p></div>`;
}

// 兩排 5 格：飽足、心情，旁邊一句話告訴小朋友什麼時候該回來
function pips(n, cls) {
  return Array.from({ length: 5 }, (_, i) => `<i class="${cls}${i < n ? '' : ' off'}"></i>`).join('');
}
function gauges(p, m) {
  let fullTip, joyTip;
  if (m === 'asleep') fullTip = '睡著了，叫醒牠吧';
  else if (p.full === 0) fullTip = '餓了，快餵牠！';
  else if (p.hungry_in < 60) fullTip = '快要餓了';
  else fullTip = `大約 ${Math.round(p.hungry_in / 60)} 小時後會餓`;
  if (m === 'quiet') joyTip = '上課時間在休息';
  else if (m === 'asleep') joyTip = '在睡覺';
  else if (m === 'angry') joyTip = p.sulky ? '吃飽了，摸摸牠就不氣了' : '餓到生氣了';
  else if (p.joy >= 4) joyTip = '好開心！';
  else if (p.joy === 3) joyTip = '還想再被摸摸';
  else if (p.joy === 2) joyTip = '有點無聊，摸摸牠吧';
  else joyTip = '肚子餓，沒心情玩';
  return `<div class="gauges">
    <div class="gauge" aria-label="飽足 ${p.full} 格（滿 5 格）"><b>飽足</b><span>${pips(p.full, 'meat')}</span><small>${fullTip}</small></div>
    <div class="gauge" aria-label="心情 ${p.joy} 格（滿 5 格）"><b>心情</b><span>${pips(p.joy, 'heart')}</span><small>${joyTip}</small></div>
  </div>`;
}

// ---------- 寵物島場景 ----------
// 座標：島圖（L-07）上的比例 0～1。WALK 是草原＋沙灘可以走的範圍，LAKE 是湖（不能站）。
const GW = 1120, GH = 842;                        // 場景裡島圖的大小（舞台 1600×900 的座標）
const WALK = [[.22, .33], [.36, .29], [.6, .29], [.66, .4], [.76, .53], [.93, .56], [.92, .66], [.76, .79],
              [.5, .83], [.4, .8], [.3, .7], [.2, .58], [.18, .45]];
const LAKE = { x: .455, y: .43, rx: .21, ry: .15 };
const EGG_AT = { x: .58, y: .7 };
function walkable(x, y) {
  if (((x - LAKE.x) / LAKE.rx) ** 2 + ((y - LAKE.y) / LAKE.ry) ** 2 < 1) return false;
  let inside = false;
  for (let i = 0, j = WALK.length - 1; i < WALK.length; j = i++) {
    const [xi, yi] = WALK[i], [xj, yj] = WALK[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function somewhere(near) {
  for (let k = 0; k < 60; k++) {
    const x = near ? near.x + rnd(-.18, .18) : rnd(.18, .93);
    const y = near ? near.y + rnd(-.12, .12) : rnd(.29, .84);
    if (walkable(x, y)) return { x, y };
  }
  return { x: .7, y: .68 };
}
// 前面（y 大）的看起來大一點
const depth = (y) => .78 + (y - .29) * .55;
const SIZE = [0, 128, 150, 172];

let actors = [];            // { p, el, img, x, y, tx, ty, mode, until, face, frame, speed }
let selected = null;        // 選到哪一隻（id）
let raf = 0, last = 0;
let busy = false;           // 餵食／摸摸的動畫還在跑
let talkTimer = 0;

function stopScene() {
  cancelAnimationFrame(raf);
  raf = 0;
  actors = [];
  clearTimeout(talkTimer);
}

function openScene({ select, say: first } = {}) {
  const home = myPet();
  selected = select ?? selected ?? home?.id ?? state.pets[0]?.id;
  if (!petById(selected)) selected = home?.id ?? state.pets[0]?.id;
  show(`<div class="pisle" role="dialog" aria-modal="true" aria-label="寵物島">
    <button class="x" data-close aria-label="關閉，回到地圖"></button>
    <section class="ground" style="width:${GW}px;height:${GH}px">
      <img class="land" src="img/pet/island.webp" alt="">
      <div class="actors"></div>
      <p class="hint">點一下看牠，按住可以把牠拎到別的地方</p>
    </section>
    <aside class="care"></aside></div>`);
  const box = $('.actors', layer);
  state.pets.forEach((p) => addActor(box, p));
  if (canAdopt()) addEgg(box);
  paintCare();
  if (first) say(first, selected);
  else if (home) say(pick(LINES[moodOf(home) === 'angry' && home.sulky ? 'sulky' : moodOf(home)] ?? LINES.normal), home.id);
  news = [];
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

function addActor(box, p, at) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'actor';
  el.innerHTML = '<span class="shadow"></span><span class="body"><img alt=""></span><span class="tag"></span><span class="bub" hidden></span>';
  box.appendChild(el);
  const pos = at ?? somewhere();
  const a = { p, el, img: $('img', el), x: pos.x, y: pos.y, tx: pos.x, ty: pos.y, mode: 'rest', until: performance.now() + rnd(300, 1500), face: Math.random() < .5 ? 1 : -1, frame: 0, pose: '' };
  actors.push(a);
  dress(a);
  grab(a);
  place(a);
  return a;
}
function addEgg(box) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'actor egg-nest';
  el.setAttribute('aria-label', '新的時光蛋：領養一隻新夥伴');
  el.innerHTML = '<img src="img/pet/egg/nest.webp" alt=""><img class="glint" src="img/fx/sparkle.webp" alt="">';
  el.style.cssText = `left:${EGG_AT.x * GW}px;top:${EGG_AT.y * GH}px;z-index:${Math.round(EGG_AT.y * 1000)}`;
  el.onclick = () => openAdopt({ more: true });
  box.appendChild(el);
}

// 名牌、頭上的符號、大小
function dress(a) {
  const p = a.p;
  const m = moodOf(p);
  const h = SIZE[p.stage] ?? 112;
  a.el.style.setProperty('--h', h + 'px');
  a.el.classList.toggle('tending', !!p.active);
  a.el.classList.toggle('sel', p.id === selected);
  a.el.setAttribute('aria-label', `${p.name}（${m === 'quiet' ? '上課時間在休息' : MOOD[m]}）`);
  $('.tag', a.el).textContent = p.name;
  const mark = p.active ? MARK[m] ?? '' : '';
  const bub = $('.bub', a.el);
  if (!a.talking) { bub.textContent = mark; bub.hidden = !mark; bub.className = 'bub mark'; }
  if (['asleep', 'quiet', 'angry'].includes(m) && !['held', 'eat', 'goeat', 'show'].includes(a.mode)) { a.mode = 'still'; setPose(a, POSE[m]); }
  else if (a.mode === 'still') { a.mode = 'rest'; a.until = 0; }
}
function setPose(a, pose) {
  if (a.pose === pose) return;
  a.pose = pose;
  a.img.src = art(a.p.species, a.p.stage, pose);
}
function place(a) {
  a.el.style.left = (a.x * GW) + 'px';
  a.el.style.top = (a.y * GH) + 'px';
  a.el.style.zIndex = a.mode === 'held' ? 2000 : Math.round(a.y * 1000);
  a.el.style.setProperty('--d', depth(a.y).toFixed(3));
  a.el.style.setProperty('--f', a.face);
}

// 每一格：走路、休息、玩、打瞌睡
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  for (const a of actors) {
    if (a.mode === 'held' || a.mode === 'still' || a.mode === 'eat' || a.mode === 'show') continue;
    const m = moodOf(a.p);
    if (a.mode === 'walk' || a.mode === 'goeat') {
      const dx = (a.tx - a.x) * GW, dy = (a.ty - a.y) * GH;
      const d = Math.hypot(dx, dy);
      const speed = (m === 'hungry' ? 34 : m === 'happy' ? 80 : 58) * depth(a.y);
      if (d < 3) {
        a.x = a.tx; a.y = a.ty;
        if (a.mode === 'goeat') { a.mode = 'eat'; a.arrive?.(); }
        else { a.mode = 'rest'; a.until = now + rnd(1500, 4500); a.restPose = restPose(a); }
      } else {
        a.x += dx / d * speed * dt / GW;
        a.y += dy / d * speed * dt / GH;
        if (Math.abs(dx) > 2) a.face = dx > 0 ? 1 : -1;
        a.frame = Math.floor(now / 230) % 2;
        setPose(a, a.frame ? 'walk2' : 'walk1');
      }
    } else if (a.mode === 'rest') {
      setPose(a, a.restPose ?? POSE[m]);
      if (now > a.until) {
        const t = somewhere(Math.random() < .6 ? a : null);
        a.tx = t.x; a.ty = t.y; a.mode = 'walk';
      }
    }
    place(a);
  }
  raf = requestAnimationFrame(tick);
}
// 停下來時做什麼：島上的會玩、跳、打瞌睡；照顧中的看心情
function restPose(a) {
  const m = moodOf(a.p);
  if (m === 'hungry') return 'hungry';
  if (m === 'happy') return pick(['cheer', 'jump', 'idle']);
  return pick(['idle', 'idle', 'play', 'jump', ...(a.p.active ? [] : ['sleep'])]);
}

// 拎起來：按住拖動；沒拖動就是點一下（選牠；選了再點＝摸摸）
function grab(a) {
  const el = a.el;
  el.addEventListener('pointerdown', (e) => {
    if (busy || e.button > 0) return;
    const g = $('.ground', layer).getBoundingClientRect();
    const k = g.width / GW;
    const start = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y, mode: a.mode };
    let held = false, ok = { x: a.x, y: a.y };
    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!held && Math.hypot(dx, dy) < 8) return;
      if (!held) {
        held = true;
        el.setPointerCapture?.(e.pointerId);
        a.mode = 'held';
        el.classList.add('held');
        setPose(a, 'jump');               // 之後換成「被拎起來」的動作格
      }
      // 手指拎在背上，所以腳在手指下方一點
      const x = (ev.clientX - g.left) / k / GW, y = (ev.clientY - g.top) / k / GH + .05;
      a.x = Math.min(.98, Math.max(.02, x)); a.y = Math.min(.95, Math.max(.05, y));
      const good = walkable(a.x, a.y);
      el.classList.toggle('bad', !good);
      if (good) ok = { x: a.x, y: a.y };
      place(a);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!held) { tap(a); return; }
      el.classList.remove('held', 'bad');
      if (!walkable(a.x, a.y)) { a.x = ok.x; a.y = ok.y; }
      a.tx = a.x; a.ty = a.y;
      el.classList.add('drop');
      setTimeout(() => el.classList.remove('drop'), 450);
      a.mode = start.mode === 'still' ? 'still' : 'rest';
      a.until = performance.now() + rnd(1200, 2500);
      a.restPose = 'cheer';
      dress(a);
      if (a.mode === 'still') setPose(a, POSE[moodOf(a.p)]);
      place(a);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
  el.addEventListener('click', (e) => e.preventDefault());
}
function tap(a) {
  if (selected !== a.p.id) {
    selected = a.p.id;
    actors.forEach(dress);
    paintCare();
    const m = moodOf(a.p);
    say(pick(LINES[m === 'angry' && a.p.sulky ? 'sulky' : m] ?? LINES.normal), a.p.id);
    return;
  }
  if (a.p.active) pat();
  else say(pick(LINES.island), a.p.id);
}

// 頭上的對話泡泡
function say(text, id) {
  const a = actors.find((x) => x.p.id === id);
  if (!a) return;
  actors.forEach((x) => { if (x !== a && x.talking) { x.talking = false; dress(x); } });
  const bub = $('.bub', a.el);
  bub.className = 'bub talk';
  bub.textContent = text;
  bub.hidden = false;
  a.talking = true;
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => { a.talking = false; if (a.el.isConnected) dress(a); }, 4200);
}
function floatUp(a, t) {
  const f = document.createElement('span');
  f.className = 'float';
  f.textContent = t;
  a.el.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}

// ---------- 右邊的照顧面板 ----------
function paintCare() {
  const box = $('aside.care', layer);
  if (!box) return;
  const p = petById(selected);
  const others = state.pets;
  const stamps = state.stamps ?? 0;
  const left = freeStarters();
  const locked = (state.unlock_at ?? []).filter((n) => stamps < n).slice(0, Math.max(0, left.length - (canAdopt() ? 1 : 0)));
  const roster = others.map((x) => `<button type="button" class="pal-s${x.id === selected ? ' on' : ''}${x.active ? ' care' : ''}" data-sel="${x.id}" aria-label="${esc(x.name)}">
      <img src="${art(x.species, x.stage)}" alt="">${x.active ? '<i>照顧中</i>' : ''}</button>`).join('')
    + (canAdopt() ? '<button type="button" class="pal-s new" data-adopt aria-label="新的時光蛋：領養一隻新夥伴"><span class="egg"></span><i>新的蛋！</i></button>' : '')
    + locked.map((n) => `<span class="pal-s locked" title="護照蓋到 ${n} 個章就能領養"><img src="${art(left[0]?.code ?? 'puppy')}" alt=""><i>${n} 個章</i></span>`).join('');
  let body = '';
  if (p?.active) {
    const m = moodOf(p);
    const inv = state.inventory ?? {};
    const bag = state.items.map((i) => {
      const n = inv[i.code] ?? 0;
      return `<button type="button" class="food${n ? '' : ' none'}" data-feed="${esc(i.code)}" ${n && m !== 'quiet' ? '' : 'disabled'}
        aria-label="餵${esc(i.name)}（還有 ${n} 個）"><span class="ic">${icon(i)}</span><b>${esc(i.name)}</b><small>× ${n}</small></button>`;
    }).join('');
    const pct = p.next_xp ? Math.min(100, Math.round(p.xp / p.next_xp * 100)) : 100;
    body = `${newsHtml()}
      <div class="nm"><h2>${esc(p.name)}</h2><button type="button" class="ghost small" data-rename>改名</button></div>
      <p class="kind">${esc(speciesName(p.species))}・${STAGE[p.stage]}・<span class="mood m-${m}">${m === 'quiet' ? '上課時間在休息' : MOOD[m]}</span></p>
      ${gauges(p, m)}
      <div class="xp" aria-label="長大進度"><i style="width:${pct}%"></i></div>
      <small class="xpt">${p.next_xp ? `再 ${p.next_xp - p.xp} 點長成${STAGE[p.stage + 1]}（吃點心長得最快）` : '已經是完全體了！'}</small>
      <h3>背包 <small>點一下拿去餵</small></h3>
      <div class="bag">${bag}</div>
      <div class="row"><button type="button" class="btn small" data-pat ${m === 'quiet' ? 'disabled' : ''}>${m === 'asleep' ? '叫醒牠' : '摸摸'}</button></div>
      ${wish()}`;
  } else if (p) {
    const home = myPet();
    body = `<div class="nm"><h2>${esc(p.name)}</h2></div>
      <p class="kind">${esc(speciesName(p.species))}・${STAGE[p.stage]}・<span class="mood">在島上玩</span></p>
      <p class="lead">${esc(p.name)}在島上自己找東西吃，不用餵。可是只有「照顧中」的那一隻會長大喔。</p>
      <div class="row"><button type="button" class="btn small" data-swap="${p.id}">換牠照顧</button></div>
      ${home ? `<p class="note">換了以後，${esc(home.name)}會回到島上自己玩。</p>` : ''}`;
  }
  box.innerHTML = `<div class="who">${body}<p class="msg" hidden></p></div>
    <div class="roster"><h3>島上的夥伴</h3><div class="pals-s">${roster}</div></div>`;
  box.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = () => { const a = actors.find((x) => x.p.id === +b.dataset.sel); if (a) tap(a); }; });
  $('[data-adopt]', box)?.addEventListener('click', () => openAdopt({ more: true }));
  $('[data-pat]', box)?.addEventListener('click', () => pat());
  box.querySelectorAll('[data-feed]').forEach((b) => { b.onclick = () => feed(b.dataset.feed); });
  $('[data-rename]', box)?.addEventListener('click', rename);
  $('[data-swap]', box)?.addEventListener('click', (e) => swap(+e.currentTarget.dataset.swap, e.currentTarget));
}
function oops(msg) {
  const m = $('aside.care .msg', layer);
  if (m) { m.textContent = msg; m.hidden = false; }
}
// 資料庫回來的新狀態套到島上的每一隻
function refresh(s) {
  state = { ...state, ...s, granted: [] };
  for (const a of actors) {
    const p = petById(a.p.id);
    if (!p) continue;
    const grew = p.stage !== a.p.stage;
    a.p = p;
    if (grew) { a.pose = ''; setPose(a, 'cheer'); }
    dress(a);
  }
  paintCare();
}

// ---------- 餵食：碗放在旁邊，牠走過去，慢慢吃完 ----------
async function feed(code) {
  if (busy) return;
  const a = actors.find((x) => x.p.active);
  if (!a) return;
  busy = true;
  layer.querySelectorAll('[data-feed]').forEach((b) => { b.disabled = true; });
  let r;
  try {
    r = await api.feed(code);
  } catch (err) {
    busy = false;
    say(err.message, a.p.id);
    a.el.classList.add('nope');
    setTimeout(() => a.el.classList.remove('nope'), 800);
    paintCare();
    return;
  }
  const i = item(code);
  const side = a.x > .7 ? -1 : 1;
  let spot = { x: a.x + side * .07, y: a.y + .015 };
  if (!walkable(spot.x, spot.y)) spot = { x: a.x - side * .07, y: a.y + .015 };
  if (!walkable(spot.x, spot.y)) spot = { x: a.x, y: Math.min(.8, a.y + .05) };
  const bowl = document.createElement('div');
  bowl.className = 'bowl';
  bowl.innerHTML = FOOD_IMG.has(code) ? `<img src="img/pet/food/${esc(code)}.webp" alt="">` : `<span>${esc(i?.icon ?? '🍽')}</span>`;
  bowl.style.cssText = `left:${spot.x * GW}px;top:${spot.y * GH}px;z-index:${Math.round(spot.y * 1000) - 1};--d:${depth(spot.y).toFixed(3)}`;
  $('.actors', layer).appendChild(bowl);
  const wasStill = a.mode === 'still';
  a.tx = spot.x - side * .045; a.ty = spot.y - .005;
  if (!walkable(a.tx, a.ty)) { a.tx = a.x; a.ty = a.y; }
  a.face = side;
  a.mode = 'goeat';
  if (wasStill) setPose(a, 'walk1');
  say(i?.kind === 'special' ? `哇！是${i.name}！` : '有吃的！', a.p.id);
  a.arrive = () => {
    a.face = side;
    place(a);
    // 吃 4 秒：吃、嚼交替，碗裡越來越少
    let n = 0;
    const steps = 10;
    const chomp = setInterval(() => {
      if (!a.el.isConnected) { clearInterval(chomp); return; }
      setPose(a, n % 2 ? 'chew' : 'eat');
      bowl.style.setProperty('--left', (1 - n / steps).toFixed(2));
      if (n % 3 === 1) floatUp(a, pick(['nom', 'nom nom', '♪']));
      if (++n > steps) {
        clearInterval(chomp);
        bowl.classList.add('done');
        setTimeout(() => bowl.remove(), 600);
        floatUp(a, `${i?.icon ?? '✨'} +${r.xp ?? 0}`);
        say(reply(r, a.p, code), a.p.id);
        refresh(r);
        a.mode = 'rest';
        a.until = performance.now() + 2500;
        a.restPose = r.was === 'angry' ? 'angry' : 'cheer';
        dress(a);
        busy = false;
      }
    }, 420);
  };
}

// ---------- 摸摸 ----------
async function pat() {
  if (busy || state.quiet) return;
  const a = actors.find((x) => x.p.active);
  if (!a) return;
  busy = true;
  try {
    const r = await api.pat();
    const was = a.mode;
    refresh(r);
    say(reply(r, a.p, null), a.p.id);
    if (a.p.mood === 'happy') {
      a.mode = 'show';
      ['pat', 'jump', 'cheer', 'jump'].forEach((pose, k) => setTimeout(() => setPose(a, pose), k * 380));
      for (let k = 0; k < 3; k++) setTimeout(() => floatUp(a, k === 0 && r.xp ? `♥ +${r.xp}` : '♥'), k * 300);
      setTimeout(() => { a.mode = 'rest'; a.until = performance.now() + 1500; a.restPose = 'cheer'; dress(a); busy = false; }, 1700);
      return;
    }
    if (r.was === 'asleep') { a.mode = 'rest'; a.until = performance.now() + 2000; a.restPose = 'hungry'; dress(a); }
    else if (was !== 'still') { a.el.classList.add('nope'); setTimeout(() => a.el.classList.remove('nope'), 800); }
  } catch (err) {
    say(err.message, a.p.id);
  }
  busy = false;
}
function reply(r, p, code) {
  if (r.did === 'feed') {
    if (r.was === 'angry') return pick(LINES.sulky);
    const i = item(code);
    return i?.kind === 'special' ? `${i.name}最好吃了！謝謝你！` : pick(['好好吃！謝謝你！', '吃飽飽，好滿足～', '嗯嗯，好香！']);
  }
  if (r.was === 'asleep') return '嗯…？你回來了！我睡好久，肚子好餓喔';
  if ((r.was === 'hungry' || r.was === 'angry') && p.mood !== 'happy') return r.was === 'angry' ? pick(LINES.angry) + '（先餵我啦）' : '肚子好餓…先餵我吃東西嘛';
  if (r.was === 'angry') return '好啦好啦，原諒你了！';
  return pick(LINES.happy);
}

// ---------- 換照顧的那隻 ----------
async function swap(id, b) {
  if (busy) return;
  b.disabled = true;
  try {
    const s = await api.swap(id);
    refresh(s);
    const p = myPet();
    say(`換我了！${p.name}會乖乖的！`, p.id);
    const a = actors.find((x) => x.p.id === p.id);
    if (a) { a.mode = 'rest'; a.restPose = 'cheer'; a.until = performance.now() + 1800; }
    paintMap();
  } catch (err) {
    oops(err.message);
    b.disabled = false;
  }
}

function rename() {
  const p = myPet();
  const box = $('aside.care .nm', layer);
  box.innerHTML = `<form class="rn" novalidate><input maxlength="8" value="${esc(p.name)}" aria-label="新名字"><button class="btn small" type="submit">好了</button></form>`;
  const f = $('form', box);
  $('input', f).focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      refresh(await api.rename($('input', f).value.trim()));
      say('這個名字我好喜歡！', p.id);
    } catch (err) {
      oops(err.message);
    }
  };
}
