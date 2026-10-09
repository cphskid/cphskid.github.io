// 主島桌寵（資料庫在 supabase/park_pet.sql；規劃書「主島桌寵系統規劃」）。
//
// 地圖：寵物島上，所有夥伴縮小了在走來走去；照顧中的那隻餓了、生氣頭上會冒符號。還沒領養時島上是一顆時光蛋。
// 寵物島（點島打開的全畫面場景）：夥伴們在島上自己走、玩、打瞌睡，可以拎起來放到別的地方。
//   點一隻看牠的狀態；一次只照顧一隻（餵食、摸摸、會餓、會長大），其他的在島上自給自足。
//   餵食：碗出現在旁邊，牠走過去慢慢吃完。
//   護照章 3 個、6 個各多一顆時光蛋，可以再領養一隻。
// 規則（會不會餓、能不能吃、長大）全部由資料庫判斷，這裡只負責畫出來和講話。
// 傢俱：寵物會自己去用（床上睡、溜滑梯、盪鞦韆、泡水、鑽帳篷…），把牠拎到傢俱上放開也會直接用；湖也能泡。
// 天空（js/petsky.js）：日夜跟著真的時間、季節跟著月份、天氣每天換，寵物會跟著反應（下雨躲帳篷、晚上想睡）。
import * as auth from './auth.js';
import { readSky, makeSky, SKY_NAME } from './petsky.js';
import { warm } from './warm.js';
import { span } from './perf.js';

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
const SKY_LINES = {
  rain: ['下雨了！快去帳篷躲雨～', '滴滴答答，下雨了耶'], snow: ['哇！下雪了！', '雪花好冰喔，嘿嘿'],
  fog: ['霧好大，看不太清楚耶'], sunny: ['太陽好大，想去泡水！'], cloudy: ['雲好多，涼涼的好舒服'],
  night: ['好睏喔…想睡覺了', '晚上的島好安靜～'], dusk: ['夕陽好漂亮！'],
};

let api = auth.pet;
// host：放地圖小東西的圖層；island：寵物島在地圖上的位置 {left, top, width}
let hooks = { me: () => ({ kind: 'guest' }), host: () => null, island: () => null, dragged: () => false, onChange: () => {} };
let state = null;            // park_pet_me() 的結果；null＝不是學生或資料庫還沒裝
let news = [];               // 剛拿到的道具（顯示一次）
let bought = [];             // 商店買的傢俱 id

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
// 補充動作（Gemini 產的 PT-05～07，三個階段都有）；EXTRA 是萬一缺圖時借的格
const EXTRA = { lift: 'jump', lift2: 'jump', land: 'idle', front1: 'walk1', front2: 'walk2', back1: 'walk1', back2: 'walk2',
                sniff: 'idle', look: 'idle', roll: 'play', yawn: 'sleep', dig: 'play', lie: 'idle',
                sit: 'idle', perch: 'idle', slide: 'jump', swim1: 'walk1', swim2: 'walk2', float: 'sleep', shake: 'play' };
const EXTRA_STAGES = [1, 2, 3];
const art = (species, stage = 1, pose = 'idle') =>
  `img/pet/${esc(species)}/${stage}-${EXTRA[pose] && !EXTRA_STAGES.includes(stage) ? EXTRA[pose] : pose}.webp`;
const POSE = { normal: 'idle', happy: 'cheer', hungry: 'hungry', angry: 'angry', asleep: 'sleep', quiet: 'sleep', island: 'idle' };
const FOOD_IMG = new Set(['kibble', 'rice-ball', 'magic-fruit', 'apple', 'carrot', 'seeds', 'biscuit', 'fish', 'mooncake']);           // 有 PT-10 圖的道具，其他先用表情符號
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
  // 商店買的傢俱（park_coins.sql 沒裝就沒有）
  bought = state ? await (api.furniture ?? auth.coins.furniture)().catch(() => []) : [];
  if (state?.granted?.length) news = state.granted;
  paintMap();
  return state;
}

// 商店買了點心、傢俱：重讀一次
addEventListener('park:shop', () => { load(); });

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
  else fullTip = `大約 ${Math.round(p.hungry_in / 60)} 小時後會餓${p.full < 5 ? '，還吃得下' : ''}`;
  if (m === 'quiet') joyTip = '上課時間在休息';
  else if (m === 'asleep') joyTip = '在睡覺';
  else if (m === 'angry') joyTip = p.sulky ? '吃飽了，摸摸牠就不氣了' : '餓到生氣了';
  else if (m === 'hungry') joyTip = '肚子餓，沒心情玩';
  else if (p.joy >= 5) joyTip = '超開心！';
  else if (p.joy >= 4) joyTip = '好開心！';
  else if (p.joy === 3) joyTip = '再陪牠玩一下';
  else joyTip = '有點無聊：摸摸、丟球、完成牠的願望';
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
// from：從哪裡走過去（整條路都要能走，才不會穿過湖）
function somewhere(near, from) {
  for (let k = 0; k < 80; k++) {
    const x = near ? near.x + rnd(-.18, .18) : rnd(.18, .93);
    const y = near ? near.y + rnd(-.12, .12) : rnd(.29, .84);
    if (walkable(x, y) && (!from || clearPath(from, { x, y }))) return { x, y };
  }
  return from ? { x: from.x, y: from.y } : { x: .7, y: .68 };
}
function clearPath(a, b) {
  for (let t = .1; t < 1; t += .1) if (!walkable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  return true;
}
// 前面（y 大）的看起來大一點
const depth = (y) => .78 + (y - .29) * .55;
const SIZE = [0, 128, 150, 172];

let actors = [];            // { p, el, img, x, y, tx, ty, mode, until, face, frame, speed }
let props = [];             // 島上的傢俱 { id, el, x, y, user }
let sky = null, skyFx = null;
let selected = null;        // 選到哪一隻（id）
let raf = 0, last = 0;
let busy = false;           // 餵食／摸摸的動畫還在跑
let talkTimer = 0;
let sceneTimers = [];
let cardOpen = false;       // 左上的狀態卡展開了沒
let bagOpen = false;        // 餵食的點心列開著沒

function stopScene() {
  cancelAnimationFrame(raf);
  raf = 0;
  actors.forEach((a) => (a.timers ?? []).forEach(clearTimeout));
  actors = [];
  props = [];
  skyFx = null;
  ball = null;
  sceneTimers.forEach(clearTimeout);
  sceneTimers = [];
  clearTimeout(talkTimer);
}

function openScene({ select, say: first } = {}) {
  const home = myPet();
  selected = select ?? selected ?? home?.id ?? state.pets[0]?.id;
  if (!petById(selected)) selected = home?.id ?? state.pets[0]?.id;
  sky = readSky();
  cardOpen = news.length > 0;
  bagOpen = false;
  show(`<div class="pisle loading" role="dialog" aria-modal="true" aria-label="寵物島" data-wx="${sky.wx}" data-tod="${sky.tod}" data-season="${sky.season}">
    <div class="view"><div class="ground-box"><section class="ground" style="width:${GW}px;height:${GH}px">
      <img class="land" src="img/pet/island.webp" alt="">
      <div class="actors"></div>
      <div class="haze" aria-hidden="true"></div>
    </section></div></div>
    <aside class="care"></aside>
    <p class="skychip">${SKY_NAME.wx[sky.wx]}・${SKY_NAME.season[sky.season]}・${SKY_NAME.tod[sky.tod]}</p>
    <p class="hint">點寵物看牠想做什麼，按住可以拎到傢俱上或湖裡</p>
    <div class="dock"><div class="pals-s"></div><nav class="bar" aria-label="照顧"></nav></div>
    <div class="bagpop" hidden></div>
    <div class="furn" hidden></div>
    <div class="veil-load" aria-live="polite"><span class="egg"></span><p>寵物島準備中…</p></div>
    <button class="x" data-close aria-label="關閉，回到地圖"></button></div>`);
  const box = $('.actors', layer);
  const fresh = freshFurniture();
  addProps(box);
  fresh.forEach((id) => props.find((o) => o.id === id)?.el.classList.add('new'));
  state.pets.forEach((p) => addActor(box, p));
  actors.forEach((a) => { if (Math.random() < .7) laterWish(a, rnd(2500, 9000)); });
  // 點空地丟球
  $('.ground', layer).addEventListener('click', (e) => {
    if (e.target.closest('.actor,.prop')) return;
    if (bagOpen || !$('.furn', layer).hidden) { closeBag(); $('.furn', layer).hidden = true; paintBar(); return; }   // 先把打開的清單收起來
    const g = $('.ground', layer).getBoundingClientRect(), k = g.width / GW;
    const at = { x: (e.clientX - g.left) / k / GW, y: (e.clientY - g.top) / k / GH };
    if (walkable(at.x, at.y)) throwBall(at);
  });
  if (canAdopt()) addEgg(box);
  skyFx = makeSky($('.ground', layer), sky, { w: GW, h: GH, lake: LAKE });
  fitScene(true);
  paintCare();
  revealScene();
  if (first) say(first, selected);
  else if (fresh.length && home) say(`哇！新的傢俱：${fresh.map((id) => FURN_NAME[id]).join('、')}！謝謝你去過關～`, home.id);
  else if (home) {
    const m = moodOf(home);
    const weather = m === 'normal' && Math.random() < .5 ? SKY_LINES[sky.tod !== 'day' ? sky.tod : sky.wx] : null;
    say(pick(weather ?? LINES[m === 'angry' && home.sulky ? 'sulky' : m] ?? LINES.normal), home.id);
  }
  news = [];
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

// 島佔滿整個視窗：照畫面大小算縮放 --g；手機直拿時島撐滿高度、可以左右滑
const isTall = (w, h) => w < h * .9;
function fitScene(first) {
  const pis = $('.pisle', layer), view = $('.view', layer);
  if (!pis || !view) return;
  const W = view.clientWidth, H = view.clientHeight;
  const contain = Math.min(W / GW, H / GH);
  const g = isTall(W, H) ? Math.min(1.1, H * .95 / GH)
    : Math.max(contain, Math.min(1.15, W / (.86 * GW), H / (.66 * GH)));
  pis.style.setProperty('--g', g.toFixed(4));
  if (!first) return;
  // 一開始對準照顧中那隻（直拿）或島中間
  const a = actors.find((x) => x.p.id === selected);
  const cx = isTall(W, H) && a ? a.x : .55, cy = .56;
  view.scrollLeft = cx * GW * g - W / 2;
  view.scrollTop = cy * GH * g - H / 2;
}
addEventListener('resize', () => { if (!layer.hidden) fitScene(false); });
// 先把島、擺出來的傢俱、每隻夥伴站著和走路的圖抓好再掀開（最多等 2.5 秒）；掀開後再在背景抓其他動作
const FIRST_POSES = ['idle', 'walk1', 'walk2', 'sit', 'front1', 'front2', 'back1', 'back2'];
async function revealScene() {
  const t0 = performance.now();
  const pis = $('.pisle', layer);
  const srcs = ['img/pet/island.webp', ...props.map((o) => `img/pet/furniture/${o.id}.webp`),
    ...actors.flatMap((a) => FIRST_POSES.map((pose) => art(a.p.species, a.p.stage, pose)))];
  await Promise.race([Promise.all(srcs.map(loadImg)), new Promise((ok) => setTimeout(ok, 2500))]);
  if (pis !== $('.pisle', layer)) return;
  pis.classList.remove('loading');
  span('寵物島掀開', t0);
  warm(...new Set(actors.map((a) => `img/pet/${a.p.species}/${a.p.stage}-`)), 'img/pet/food/', 'img/pet/furniture/');
}

function addActor(box, p, at) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'actor';
  el.innerHTML = '<span class="shadow"></span><span class="body"><img alt=""></span><span class="tag"></span><span class="bub" hidden></span><span class="wish" hidden></span>';
  box.appendChild(el);
  const pos = at ?? somewhere();
  const a = { p, el, img: $('img', el), x: pos.x, y: pos.y, tx: pos.x, ty: pos.y, mode: 'rest', until: performance.now() + rnd(300, 1500),
              face: Math.random() < .5 ? 1 : -1, frame: 0, pose: '', lift: 0, timers: [] };
  actors.push(a);
  dress(a);
  grab(a);
  place(a);
  return a;
}
// ---------- 傢俱（二期改成用時光幣換、存在資料庫）----------
// 擺的位置先記在這台電腦（localStorage），拖曳方式跟拎寵物一樣
const PROPS = [
  { id: 'bed', x: .8, y: .72, w: 120 }, { id: 'tent', x: .88, y: .62, w: 120 },
  { id: 'slide', x: .3, y: .68, w: 130 }, { id: 'fountain', x: .64, y: .79, w: 80 },
  { id: 'pool', x: .25, y: .5, w: 115 }, { id: 'swing', x: .44, y: .64, w: 100 },
  { id: 'bench', x: .68, y: .62, w: 105 }, { id: 'tunnel', x: .5, y: .8, w: 95 },
  { id: 'toybox', x: .57, y: .6, w: 62 }, { id: 'flowers', x: .24, y: .38, w: 54 },
  { id: 'lantern', x: .67, y: .45, w: 40 },
  // 下面是商店賣的（js/shop.js、park_coins.sql 的 park_shop_items）
  { id: 'scratcher', x: .36, y: .56, w: 58 }, { id: 'sandbox', x: .76, y: .86, w: 112 },
  { id: 'trampoline', x: .42, y: .86, w: 108 }, { id: 'hammock', x: .9, y: .82, w: 100 },
  { id: 'rabbit-lamp', x: .3, y: .8, w: 56 },
];
// 圖的高／寬
const ASPECT = { bed: .77, tent: .985, slide: .835, tunnel: .815, scratcher: 1.408, swing: 1.081, pool: .68, fountain: 1.136,
                 bench: .705, lantern: 1.626, flowers: 1.081, toybox: .885,
                 sandbox: .73, trampoline: .749, hammock: .966, 'rabbit-lamp': 1.176 };
// 怎麼用：at＝在傢俱圖上的哪一點（左上 0,0；右下 1,1），door＝從地上哪裡過去（預設 at 正下方的地面）
const USE = {
  bed:      { kind: 'lie', at: [.5, .58] },
  tent:     { kind: 'hide', at: [.45, .9], door: [.45, 1.03] },
  tunnel:   { kind: 'through', at: [.2, .82], door: [.14, .95], out: [.88, .8] },
  slide:    { kind: 'slide', door: [.9, 1.02], top: [.6, .16], end: [.05, .95] },
  swing:    { kind: 'sit', at: [.56, .7], sway: true },
  bench:    { kind: 'sit', at: [.3, .76] },
  pool:     { kind: 'swim', at: [.5, .62] },
  fountain: { kind: 'play', at: [.2, 1.02], poses: ['eat', 'chew'], every: 420, line: '咕嚕咕嚕，好涼！' },
  toybox:   { kind: 'play', at: [.5, 1.08], poses: ['play', 'roll', 'jump', 'cheer'], every: 900 },
  flowers:  { kind: 'play', at: [.5, 1.08], poses: ['sniff', 'look', 'sniff', 'cheer'], every: 1000, line: '花好香喔～' },
  scratcher:  { kind: 'play', at: [.5, 1.06], poses: ['play', 'shake', 'play', 'cheer'], every: 800, line: '抓抓抓！' },
  sandbox:    { kind: 'play', at: [.5, .62], poses: ['dig', 'sniff', 'dig', 'roll'], every: 900, line: '挖到寶了嗎？' },
  trampoline: { kind: 'play', at: [.5, .45], poses: ['jump', 'cheer', 'jump', 'jump'], every: 600, line: '跳得好高！' },
  hammock:    { kind: 'lie', at: [.52, .5] },
  'rabbit-lamp': { kind: 'play', at: [.5, 1.08], poses: ['look', 'cheer', 'look'], every: 1100, line: '兔子燈好漂亮！' },
};
const PROP_KEY = 'park-pet-props';
// 一開始送三件；其他的蓋護照章解鎖（FURN_STAMP：蓋到第幾個章）。之後樂園商店再加只能用時光幣換的。網址加 ?furn=all 可以全部看
const STARTER = ['bed', 'slide', 'pool'];
const FURN_STAMP = { tent: 1, swing: 2, fountain: 4, toybox: 5, bench: 7, tunnel: 8, flowers: 10, lantern: 12 };
const FURN_NAME = { bed: '軟軟小床', tent: '露營帳篷', slide: '溜滑梯', fountain: '噴水池', pool: '小泳池', swing: '盪鞦韆',
                    bench: '野餐桌椅', tunnel: '鑽鑽隧道', toybox: '玩具箱', flowers: '花盆', lantern: '小燈籠',
                    scratcher: '貓抓板', sandbox: '小沙坑', trampoline: '彈跳床', hammock: '吊床', 'rabbit-lamp': '兔子燈' };
const SHOP_FURN = { scratcher: 120, sandbox: 150, trampoline: 180, hammock: 200, 'rabbit-lamp': 250 };   // 商店價（只給清單顯示，真的價錢看資料庫）
const LIMITED = new Set(['rabbit-lamp']);   // 本月限定：沒買到就不放進清單
const OWN_KEY = 'park-pet-furniture-seen';
function ownedFurniture() {
  if (new URLSearchParams(location.search).get('furn') === 'all') return PROPS.map((d) => d.id);
  const stamps = state?.stamps ?? 0;
  return PROPS.map((d) => d.id).filter((id) => STARTER.includes(id) || stamps >= (FURN_STAMP[id] ?? 99) || bought.includes(id));
}
// 這次打開才解鎖的傢俱（記在這台電腦，只慶祝一次）
function freshFurniture() {
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(OWN_KEY) ?? 'null'); } catch { /* 讀不到就當第一次 */ }
  const own = ownedFurniture();
  try { localStorage.setItem(OWN_KEY, JSON.stringify(own)); } catch { /* 存不了就算了 */ }
  return own.filter((id) => !(seen ?? STARTER).includes(id));
}
// 收起來的傢俱（記在這台電腦）：不擺在島上，打開「我的傢俱」再拿出來
const STORE_KEY = 'park-pet-stored';
function storedFurniture() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'); } catch { return []; }
}
function setStored(id, on) {
  const all = storedFurniture().filter((x) => x !== id);
  if (on) all.push(id);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* 存不了就只這次有效 */ }
}
function propSpots() {
  try { return JSON.parse(localStorage.getItem(PROP_KEY) ?? '{}'); } catch { return {}; }
}
const propW = (o) => o.w * depth(o.y);
const propZ = (o) => Math.round(o.y * 1000) - 2;
// 傢俱圖上的一點 → 島上的座標
function propPoint(o, [fx, fy]) {
  const w = propW(o), h = w * (ASPECT[o.id] ?? 1);
  return { x: o.x + (fx - .5) * w / GW, y: o.y + (fy - .88) * h / GH };
}
// 拎著的東西底下是哪件傢俱
function propAt(x, y) {
  let hit = null;
  for (const o of props) {
    if (!USE[o.id]) continue;
    const w = propW(o), h = w * (ASPECT[o.id] ?? 1);
    const px = x * GW, py = y * GH, cx = o.x * GW, top = o.y * GH - .88 * h;
    if (px > cx - w * .5 && px < cx + w * .5 && py > top + h * .1 && py < top + h * 1.08 && (!hit || propZ(o) > propZ(hit))) hit = o;
  }
  return hit;
}
function addProps(box) {
  const own = ownedFurniture(), stored = storedFurniture();
  for (const d of PROPS.filter((x) => own.includes(x.id) && !stored.includes(x.id))) addProp(box, d);
}
function addProp(box, d) {
  const saved = propSpots();
  {
    const at = saved[d.id] && walkable(saved[d.id].x, saved[d.id].y) ? saved[d.id] : d;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `prop p-${d.id}`;
    el.setAttribute('aria-label', '傢俱（按住可以搬到別的地方）');
    el.innerHTML = `<span class="shadow"></span><img src="img/pet/furniture/${d.id}.webp" alt="">`;
    const o = { id: d.id, w: d.w, el, x: at.x, y: at.y, user: null };
    props.push(o);
    const put = () => {
      el.style.cssText = `left:${o.x * GW}px;top:${o.y * GH}px;width:${propW(o)}px;z-index:${el.classList.contains('held') ? 2000 : propZ(o)}`;
    };
    put();
    box.appendChild(el);
    el.addEventListener('pointerdown', (e) => {
      if (busy || e.button > 0) return;
      const g = $('.ground', layer).getBoundingClientRect();
      const k = g.width / GW;
      const sx = e.clientX, sy = e.clientY;
      let held = false, ok = { x: o.x, y: o.y };
      const move = (ev) => {
        if (!held && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        if (!held && o.user) leave(o.user);            // 有寵物在用：先下來
        held = true;
        el.classList.add('held');
        o.x = Math.min(.98, Math.max(.02, (ev.clientX - g.left) / k / GW));
        o.y = Math.min(.95, Math.max(.05, (ev.clientY - g.top) / k / GH + .03));
        const good = walkable(o.x, o.y);
        el.classList.toggle('bad', !good);
        if (good) ok = { x: o.x, y: o.y };
        put();
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!held) return;
        el.classList.remove('held', 'bad');
        if (!walkable(o.x, o.y)) { o.x = ok.x; o.y = ok.y; }
        el.classList.add('drop');
        setTimeout(() => el.classList.remove('drop'), 450);
        put();
        const all = propSpots();
        all[d.id] = { x: +o.x.toFixed(3), y: +o.y.toFixed(3) };
        try { localStorage.setItem(PROP_KEY, JSON.stringify(all)); } catch { /* 存不了就算了，下次回到原位 */ }
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  }
}

// 傢俱清單：有的可以擺出來或收起來（島上才不會越來越擠）；沒有的上鎖，等蓋章或用時光幣換
function toggleFurn() {
  const box = $('.furn', layer);
  if (!box.hidden) { box.hidden = true; paintBar(); return; }
  closeBag();
  paintFurn();
  box.hidden = false;
  paintBar();
}
function paintFurn() {
  const box = $('.furn', layer);
  const own = ownedFurniture();
  const out = (id) => props.some((o) => o.id === id);
  const list = PROPS.filter((d) => own.includes(d.id) || !LIMITED.has(d.id));
  box.innerHTML = `<h3>我的傢俱 <small>擺出來 ${own.filter(out).length}・全部 ${own.length} / ${list.length}</small></h3>
    <div class="furn-list">${list.map((d) => own.includes(d.id)
      ? `<button type="button" class="furn-i${out(d.id) ? ' out' : ' kept'}" data-id="${d.id}" aria-label="${FURN_NAME[d.id]}：${out(d.id) ? '在島上，點一下收起來' : '收著，點一下擺到島上'}">
          <img src="img/pet/furniture/${d.id}.webp" alt=""><b>${FURN_NAME[d.id]}</b><small>${out(d.id) ? '📦 收起來' : '🏝️ 擺出來'}</small></button>`
      : `<span class="furn-i locked"><img src="img/pet/furniture/${d.id}.webp" alt=""><b>${FURN_NAME[d.id]}</b><i>🔒</i><small>${SHOP_FURN[d.id] ? `商店 ${SHOP_FURN[d.id]}` : `${FURN_STAMP[d.id]} 個章`}</small></span>`).join('')}</div>
    <p class="note">點自己的傢俱就能收起來或擺出來；擺在島上的按住就能搬。去各個島嶼過關、蓋護照章會解鎖新傢俱，標「商店」的用時光幣買。現在有 ${state?.stamps ?? 0} 個章。</p>
    <button type="button" class="ghost small" data-furn-close>關起來</button>`;
  $('[data-furn-close]', box).onclick = () => { box.hidden = true; paintBar(); };
  box.querySelectorAll('button.furn-i').forEach((b) => { b.onclick = () => { putAway(b.dataset.id); paintFurn(); }; });
}
// 收起來／擺出來：收的時候正在用的寵物先下來
function putAway(id) {
  const o = props.find((x) => x.id === id);
  if (o) {
    if (o.user) leave(o.user);
    o.el.remove();
    props = props.filter((x) => x !== o);
    setStored(id, true);
  } else {
    setStored(id, false);
    addProp($('.actors', layer), PROPS.find((d) => d.id === id));
    const n = props.find((x) => x.id === id);
    n?.el.classList.add('drop');
    setTimeout(() => n?.el.classList.remove('drop'), 450);
  }
}

// ---------- 用傢俱、泡湖水 ----------
// 照天氣、時間挑想去哪：下雨躲帳篷、晴天想泡水、晚上想睡
function liking(id) {
  const { wx, tod, season } = sky;
  let w = 1;
  if (wx === 'rain' || wx === 'snow') w *= { tent: 6, tunnel: 3, pool: .2, lake: wx === 'snow' ? 0 : .2, swing: .4 }[id] ?? .6;
  else if (wx === 'sunny' && tod === 'day') w *= { pool: 1.6, lake: 1.4, fountain: 1.6 }[id] ?? 1;
  if (season === 'summer' && (id === 'pool' || id === 'lake')) w *= 1.6;
  if (season === 'winter' && (id === 'pool' || id === 'lake')) w *= .3;
  if (tod === 'night') w *= { bed: 5, tent: 2 }[id] ?? .5;
  return w;
}
// 湖邊找一個走得到的岸邊點
function shore(from) {
  for (let k = 0; k < 24; k++) {
    const t = Math.random() * Math.PI * 2;
    const p = { x: LAKE.x + Math.cos(t) * LAKE.rx * 1.08, y: LAKE.y + Math.sin(t) * LAKE.ry * 1.12 };
    if (walkable(p.x, p.y) && (!from || clearPath(from, p))) return p;
  }
  return null;
}
const inLake = (x, y) => ((x - LAKE.x) / LAKE.rx) ** 2 + ((y - LAKE.y) / LAKE.ry) ** 2 < 1;
function doorOf(o) {
  const u = USE[o.id];
  return propPoint(o, u.door ?? [u.at[0], Math.max(1.03, u.at[1])]);
}
// 停下來後要不要去玩傢俱；要的話走過去（a.next：走到了再開始用）
function wantUse(a) {
  const opts = [];
  for (const o of props) {
    if (!USE[o.id] || o.user || o.el.classList.contains('held')) continue;
    const d = doorOf(o);
    if (!walkable(d.x, d.y) || !clearPath(a, d)) continue;
    opts.push({ o, d, w: liking(o.id) });
  }
  const s = liking('lake') ? shore(a) : null;
  if (s) opts.push({ o: null, d: s, w: liking('lake') });
  const total = opts.reduce((n, x) => n + x.w, 0);
  if (!total) return false;
  let r = Math.random() * total;
  const c = opts.find((x) => (r -= x.w) < 0) ?? opts[0];
  if (c.o) { c.o.user = a; a.using = c.o; }
  a.tx = c.d.x; a.ty = c.d.y; a.mode = 'walk';
  a.next = () => (c.o ? useProp(a, c.o) : swimLake(a));
  return true;
}

const wait = (a, ms) => new Promise((r) => a.timers.push(setTimeout(r, ms)));
// 從現在的位置滑／跳到 to（arc＞0 會跳一個弧線），poses 會輪播
function glide(a, to, ms, { arc = 0, poses = null, every = 220 } = {}) {
  return new Promise((done) => { a.tw = { x0: a.x, y0: a.y, x1: to.x, y1: to.y, t0: performance.now(), ms, arc, poses, every, done }; });
}
function loop(a, poses, every) { a.cycle = poses ? { poses, every } : null; if (poses) setPose(a, poses[0]); }

async function useProp(a, o, dropped = false) {
  const u = USE[o.id];
  const id = a.useId = (a.useId ?? 0) + 1;
  const still = () => a.useId === id && a.el.isConnected;
  o.user = a; a.using = o;
  a.mode = 'use'; a.next = null;
  a.z = propZ(o) + 1;
  if (dropped) wishDone(a, o.id);
  const P = (f) => propPoint(o, f);
  const door = doorOf(o);
  let exit = door;
  if (u.kind === 'lie' || u.kind === 'sit' || u.kind === 'swim') {
    a.el.classList.add('up');
    await glide(a, P(u.at), 480, { arc: 46, poses: ['jump'] });
    if (!still()) return;
    if (u.kind === 'lie') {
      setPose(a, 'lie');
      a.face = Math.random() < .5 ? 1 : -1;
      const sleepy = sky.tod === 'night' || !a.p.active;
      await wait(a, sleepy ? 1400 : rnd(4000, 6500));
      if (!still()) return;
      if (sleepy) { setPose(a, 'sleep'); floatUp(a, 'Zz'); await wait(a, rnd(5000, 9000)); if (!still()) return; setPose(a, 'yawn'); await wait(a, 1000); }
    } else if (u.kind === 'sit') {
      setPose(a, 'perch');
      if (u.sway) a.el.classList.add('sway');
      await wait(a, rnd(4000, 7500));
      if (!still()) return;
      a.el.classList.remove('sway');
    } else {
      a.el.classList.add('wade');
      floatUp(a, '💦');
      for (let k = 0; k < 2; k++) {
        const c = P(u.at), t = { x: c.x + rnd(-.015, .015), y: c.y + rnd(-.008, .008) };
        a.face = t.x > a.x ? 1 : -1;
        await glide(a, t, 1600, { poses: ['swim1', 'swim2'], every: 380 });
        if (!still()) return;
      }
      setPose(a, 'float');
      await wait(a, rnd(2500, 4000));
      if (!still()) return;
      a.el.classList.remove('wade');
      exit = P([.5, 1.1]);
    }
    await glide(a, exit, 420, { arc: 34, poses: ['jump'] });
    if (!still()) return;
    a.el.classList.remove('up');
    if (u.kind === 'swim') { setPose(a, 'shake'); floatUp(a, '💦'); await wait(a, 1100); }
  } else if (u.kind === 'hide' || u.kind === 'through') {
    if (dropped) await glide(a, door, 300, { arc: 20, poses: ['jump'] });
    if (!still()) return;
    await glide(a, P(u.at), 450, { poses: ['back1', 'back2'] });
    if (!still()) return;
    a.el.classList.add('inside');
    o.el.classList.add('rustle');
    if (u.kind === 'through') {
      exit = P(u.out);
      a.face = exit.x > a.x ? 1 : -1;
      await glide(a, exit, 1800);
    } else await wait(a, rnd(3500, 7000));
    if (!still()) return;
    o.el.classList.remove('rustle');
    a.el.classList.remove('inside');
    if (u.kind === 'hide') await glide(a, door, 450, { poses: ['front1', 'front2'] });
    if (!still()) return;
    setPose(a, 'cheer');
    await wait(a, 800);
  } else if (u.kind === 'slide') {
    if (!dropped) {
      a.el.classList.add('up');
      a.face = 1;
      await glide(a, P(u.top), 1100, { poses: ['back1', 'back2'], every: 200 });
    } else await glide(a, P(u.top), 300, { arc: 20, poses: ['lift'] });
    if (!still()) return;
    a.el.classList.add('up');
    a.face = -1;
    setPose(a, 'look');
    await wait(a, 500);
    if (!still()) return;
    exit = P(u.end);
    await glide(a, exit, 650, { poses: ['slide'] });
    if (!still()) return;
    a.el.classList.remove('up');
    setPose(a, 'land');
    await wait(a, 280);
    setPose(a, 'cheer');
    floatUp(a, pick(['好好玩！', '再一次！', '咻～']));
    await wait(a, 900);
  } else {
    if (dropped) await glide(a, P(u.at), 300, { arc: 20, poses: ['jump'] });
    a.face = o.x > a.x ? 1 : -1;
    if (u.line && Math.random() < .5) floatUp(a, u.line);
    loop(a, u.poses, u.every);
    await wait(a, rnd(2600, 4200));
    loop(a, null);
    exit = { x: a.x, y: a.y };
  }
  if (still()) leave(a, exit);
}

// 泡湖水：從岸邊走進去游一游，再上岸甩水
async function swimLake(a, at) {
  const id = a.useId = (a.useId ?? 0) + 1;
  const still = () => a.useId === id && a.el.isConnected;
  a.mode = 'use'; a.next = null; a.using = null;
  if (at) wishDone(a, 'lake');
  a.el.classList.add('wade');
  const ang = Math.atan2((a.y - LAKE.y) / LAKE.ry, (a.x - LAKE.x) / LAKE.rx);
  const ring = (t, r) => ({ x: LAKE.x + Math.cos(t) * LAKE.rx * r, y: LAKE.y + Math.sin(t) * LAKE.ry * r });
  floatUp(a, '💦');
  let t = ang;
  if (!at) {
    const p = ring(t, .62);
    a.face = p.x > a.x ? 1 : -1;
    await glide(a, p, 700, { poses: ['swim1', 'swim2'], every: 380 });
  }
  for (let k = 0; k < 2; k++) {
    if (!still()) return;
    t += rnd(-.6, .6);
    const p = ring(t, rnd(.35, .62));
    a.face = p.x > a.x ? 1 : -1;
    await glide(a, p, 2200, { poses: ['swim1', 'swim2'], every: 380 });
  }
  if (!still()) return;
  setPose(a, 'float');
  await wait(a, rnd(2500, 4000));
  if (!still()) return;
  // 游回最近的岸邊
  let out = null;
  for (let k = 0; k < 16 && !out; k++) {
    const tt = t + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * .35, p = ring(tt, 1.1);
    if (walkable(p.x, p.y)) out = p;
  }
  out ??= somewhere(null);
  a.face = out.x > a.x ? 1 : -1;
  await glide(a, out, 900, { poses: ['swim1', 'swim2'], every: 380 });
  if (!still()) return;
  a.el.classList.remove('wade');
  setPose(a, 'shake');
  floatUp(a, '💦');
  await wait(a, 1100);
  if (still()) leave(a, out);
}

// ---------- 小願望：寵物頭上冒出想做的事，幫牠完成就很開心（一隻一天最多 3 個）----------
const WISH_TEXT = { bed: '想去床上躺躺', slide: '想溜滑梯！', pool: '想去泳池泡水～', tent: '想躲進帳篷', swing: '想盪鞦韆！',
                    fountain: '想喝水', toybox: '想玩玩具', bench: '想坐下來休息', tunnel: '想鑽隧道', flowers: '想去聞花香',
                    lake: '想去湖裡游泳！', ball: '想玩丟球！（點一下地上）' };
const WISH_KEY = 'park-pet-wish';
const today = () => new Date().toLocaleDateString('sv');
function wishBook() {
  try { const w = JSON.parse(localStorage.getItem(WISH_KEY) ?? '{}'); if (w.date === today()) return w; } catch { /* 讀不到就重來 */ }
  return { date: today(), done: {} };
}
const canWish = (a) => !['hungry', 'angry', 'asleep', 'quiet'].includes(moodOf(a.p)) && sky?.wx !== 'snow';
function giveWish(a) {
  if (!a.el.isConnected || a.wish || !canWish(a) || (wishBook().done[a.p.id] ?? 0) >= 3) return;
  const opts = [...ownedFurniture().filter((id) => USE[id]), 'ball', ...(sky.wx === 'rain' ? [] : ['lake'])];
  a.wish = pick(opts);
  const w = $('.wish', a.el);
  w.innerHTML = USE[a.wish] ? `<img src="img/pet/furniture/${a.wish}.webp" alt="">` : `<span>${a.wish === 'lake' ? '🌊' : '⚾'}</span>`;
  w.hidden = false;
  a.el.setAttribute('aria-description', WISH_TEXT[a.wish]);
}
function laterWish(a, ms) { sceneTimers.push(setTimeout(() => giveWish(a), ms)); }
function wishDone(a, what) {
  if (!a.wish || a.wish !== what) return;
  a.wish = null;
  $('.wish', a.el).hidden = true;
  a.el.removeAttribute('aria-description');
  const book = wishBook();
  book.done[a.p.id] = (book.done[a.p.id] ?? 0) + 1;
  try { localStorage.setItem(WISH_KEY, JSON.stringify(book)); } catch { /* 存不了就算了 */ }
  for (let k = 0; k < 3; k++) a.timers.push(setTimeout(() => floatUp(a, '♥'), k * 250));
  say(pick(['謝謝你！你最懂我了！', '耶～好開心！', '最喜歡你了！']), a.p.id);
  // 照顧中的那隻：心情 +4、經驗 +1（一天前 3 次，資料庫判斷）
  if (a.p.active && !state.quiet) api.play('wish').then(refresh).catch(() => {});
  if (book.done[a.p.id] < 3) laterWish(a, rnd(25000, 45000));
}

// ---------- 丟球：點地上，球飛過去，寵物追過去推著玩 ----------
let ball = null;
function addBall(from) {
  const el = document.createElement('span');
  el.className = 'ball';
  $('.actors', layer).appendChild(el);
  ball = { el, x: from.x, y: from.y, lift: 0, tw: null };
  placeBall();
  return ball;
}
function placeBall() {
  const b = ball;
  b.el.style.cssText = `left:${b.x * GW}px;top:${b.y * GH - b.lift}px;z-index:${Math.round(b.y * 1000) + 1};--d:${depth(b.y).toFixed(3)}`;
}
function flyBall(to, ms, arc) {
  return new Promise((done) => { ball.tw = { x0: ball.x, y0: ball.y, x1: to.x, y1: to.y, t0: performance.now(), ms, arc, done }; });
}
function stepBall(now) {
  const w = ball?.tw;
  if (!w) return;
  const t = Math.min(1, (now - w.t0) / w.ms);
  ball.x = w.x0 + (w.x1 - w.x0) * t; ball.y = w.y0 + (w.y1 - w.y0) * t;
  ball.lift = w.arc * Math.sin(Math.PI * t) * (1 - t * .35);
  ball.el.style.transform = `translate(-50%,-100%) rotate(${t * 540}deg)`;
  placeBall();
  if (t >= 1) { ball.tw = null; ball.lift = 0; w.done(); }
}
// 走過去（看方向用正面／背面／側面的格），speed 是每秒幾點
function runTo(a, to, speed = 140) {
  const dx = (to.x - a.x) * GW, dy = (to.y - a.y) * GH;
  if (Math.abs(dx) > 2) a.face = dx > 0 ? 1 : -1;
  const dir = Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy > 0 ? 'front' : 'back') : 'walk';
  return glide(a, to, Math.max(250, Math.hypot(dx, dy) / (speed * depth(a.y)) * 1000), { poses: [dir + 1, dir + 2], every: 160 });
}
const free = (a) => ['rest', 'walk'].includes(a.mode) && !a.using && !['asleep', 'quiet', 'angry'].includes(moodOf(a.p));
async function throwBall(at) {
  if (ball || busy) return;
  const a = actors.find((x) => x.p.id === selected && (free(x) || x.mode === 'use')) ?? actors.find(free);
  if (!a) return;
  if (a.mode === 'use' || a.using) leave(a);
  const id = a.useId = (a.useId ?? 0) + 1;
  const still = () => a.useId === id && a.el.isConnected && ball;
  a.mode = 'use'; a.next = null;
  addBall({ x: .55, y: .92 });
  say(pick(['球！球！', '我來了！', '看我的！']), a.p.id);
  // 附近的夥伴偶爾也跑過去湊熱鬧
  actors.filter((b) => b !== a && free(b) && Math.random() < .5).forEach((b) => {
    const t = somewhere(at, b);
    b.tx = t.x; b.ty = t.y; b.mode = 'walk';
    b.next = () => { b.mode = 'rest'; b.until = performance.now() + rnd(1500, 2500); b.restPose = 'cheer'; };
  });
  let spot = at;
  await flyBall(spot, 650, 90);
  for (let k = 0; k < 3; k++) {
    if (!still()) break;
    const side = ball.x > a.x ? -1 : 1;
    await runTo(a, { x: ball.x + side * .035, y: ball.y + .004 });
    if (!still()) break;
    a.face = -side;
    setPose(a, k === 2 ? 'cheer' : 'play');
    floatUp(a, k === 2 ? '♪' : pick(['嘿！', '咚！']));
    await wait(a, 450);
    if (k === 2 || !still()) break;
    // 推一下，球滾到旁邊
    let next = null;
    for (let n = 0; n < 12 && !next; n++) {
      const p = { x: ball.x - side * rnd(.06, .14), y: ball.y + rnd(-.06, .06) };
      if (walkable(p.x, p.y)) next = p;
    }
    if (!next) break;
    await flyBall(next, 500, 22);
  }
  if (ball) { const b = ball.el; b.classList.add('gone'); setTimeout(() => b.remove(), 500); ball = null; }
  if (a.useId !== id) return;
  if (a.wish === 'ball') wishDone(a, 'ball');
  else if (a.p.active && !state.quiet) api.play('ball').then(refresh).catch(() => {});   // 陪牠玩：心情 +2
  leave(a);
}

// ---------- 兩隻碰在一起玩：走過去、一起跳、再你追我跑 ----------
function wantFriend(a) {
  const b = actors.filter((x) => x !== a && free(x) && clearPath(a, x)).sort(() => Math.random() - .5)[0];
  if (!b) return false;
  playTogether(a, b);
  return true;
}
async function playTogether(a, b) {
  const ida = a.useId = (a.useId ?? 0) + 1, idb = b.useId = (b.useId ?? 0) + 1;
  const ok = () => a.useId === ida && b.useId === idb && a.el.isConnected;
  a.mode = 'use'; b.mode = 'use'; a.next = b.next = null;
  a.partner = b; b.partner = a;
  b.tw = null; b.face = a.x > b.x ? 1 : -1; setPose(b, 'look');
  const side = a.x < b.x ? -1 : 1;
  let meet = { x: b.x + side * .07, y: b.y };
  if (!walkable(meet.x, meet.y)) meet = { x: b.x - side * .07, y: b.y };
  if (!walkable(meet.x, meet.y)) { leave(a); return; }
  await runTo(a, meet, 70);
  if (!ok()) return;
  a.face = b.x > a.x ? 1 : -1; b.face = -a.face;
  loop(a, ['play', 'jump', 'cheer'], 420); loop(b, ['jump', 'play', 'cheer'], 420);
  floatUp(a, '♥'); floatUp(b, '♪');
  await wait(a, 2400);
  if (!ok()) return;
  loop(a, null); loop(b, null);
  // 你追我跑：a 先跑，b 跟在後面
  const far = somewhere(null, a);
  b.timers.push(setTimeout(() => { if (ok()) runTo(b, { x: far.x - (far.x > b.x ? .05 : -.05), y: far.y }, 125); }, 350));
  await runTo(a, far, 135);
  if (!ok()) return;
  setPose(a, 'cheer');
  await wait(a, 700);
  if (!ok()) return;
  a.partner = b.partner = null;
  leave(b); leave(a);
}

// 結束（或被打斷）：放開傢俱、回到地上；to＝要站的位置（不給就留在原地）
function leave(a, to) {
  a.useId = (a.useId ?? 0) + 1;
  a.timers.forEach(clearTimeout);
  a.timers = [];
  a.tw = null; a.cycle = null; a.next = null; a.lift = 0; a.z = null;
  const pal = a.partner;
  a.partner = null;
  if (pal?.partner === a) { pal.partner = null; leave(pal); }      // 一起玩的那隻也放開
  if (a.using) { a.using.user = null; a.using.el.classList.remove('rustle'); a.using = null; }
  a.el.classList.remove('up', 'sway', 'wade', 'inside');
  if (to === undefined && a.mode === 'use' && !walkable(a.x, a.y)) to = somewhere({ x: a.x, y: a.y });
  if (to && !walkable(to.x, to.y)) to = somewhere(to);
  if (to) { a.x = to.x; a.y = to.y; }
  a.tx = a.x; a.ty = a.y;
  if (a.mode === 'use' || a.mode === 'walk') { a.mode = 'rest'; a.until = performance.now() + rnd(1500, 3500); a.restPose = restPose(a); }
  place(a);
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
  if (['asleep', 'quiet', 'angry'].includes(m) && !['held', 'eat', 'goeat', 'show'].includes(a.mode)) {
    if (a.mode === 'use' || a.using) leave(a);
    a.mode = 'still'; setPose(a, POSE[m]);
  } else if (a.mode === 'still') { a.mode = 'rest'; a.until = 0; }
}
// 動作圖先在背景抓好、解碼好才換上去；還沒好就先留著上一格（不會閃一下空白）
const poseCache = new Map();
function loadImg(src) {
  let p = poseCache.get(src);
  if (!p) {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    p = (im.decode ? im.decode() : new Promise((ok) => { im.onload = ok; im.onerror = ok; })).then(() => true, () => true);
    p.done = false;
    p.then(() => { p.done = true; });
    poseCache.set(src, p);
  }
  return p;
}
function setPose(a, pose) {
  if (a.pose === pose) return;
  a.pose = pose;
  const src = art(a.p.species, a.p.stage, pose);
  const p = loadImg(src);
  if (p.done || !a.img.getAttribute('src')) { a.img.src = src; return; }
  p.then(() => { if (a.pose === pose && a.el.isConnected) a.img.src = src; });
}
function place(a) {
  a.el.style.left = (a.x * GW) + 'px';
  a.el.style.top = (a.y * GH - (a.lift ?? 0)) + 'px';
  a.el.style.zIndex = a.mode === 'held' ? 2000 : a.z ?? Math.round(a.y * 1000);
  a.el.style.setProperty('--d', depth(a.y).toFixed(3));
  a.el.style.setProperty('--f', a.face);
}

// 每一格：走路、休息、玩、打瞌睡、用傢俱
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  skyFx?.step(dt);
  stepBall(now);
  for (const a of actors) {
    if (a.mode === 'use') {
      if (a.tw) {
        const w = a.tw, t = Math.min(1, (now - w.t0) / w.ms);
        a.x = w.x0 + (w.x1 - w.x0) * t; a.y = w.y0 + (w.y1 - w.y0) * t;
        a.lift = w.arc * Math.sin(Math.PI * t);
        if (w.poses) setPose(a, w.poses[Math.floor(now / w.every) % w.poses.length]);
        if (t >= 1) { a.tw = null; a.lift = 0; w.done(); }
      } else if (a.cycle) setPose(a, a.cycle.poses[Math.floor(now / a.cycle.every) % a.cycle.poses.length]);
      place(a);
      continue;
    }
    if (a.mode === 'held' || a.mode === 'still' || a.mode === 'eat' || a.mode === 'show') continue;
    const m = moodOf(a.p);
    if (a.mode === 'walk' || a.mode === 'goeat') {
      const dx = (a.tx - a.x) * GW, dy = (a.ty - a.y) * GH;
      const d = Math.hypot(dx, dy);
      const speed = (m === 'hungry' ? 34 : m === 'happy' ? 80 : 58) * depth(a.y);
      if (d < 3) {
        a.x = a.tx; a.y = a.ty;
        if (a.mode === 'goeat') { a.mode = 'eat'; a.arrive?.(); }
        else if (a.next) { const go = a.next; a.next = null; go(); }
        else { a.mode = 'rest'; a.until = now + rnd(1500, 4500); a.restPose = restPose(a); }
      } else {
        a.x += dx / d * speed * dt / GW;
        a.y += dy / d * speed * dt / GH;
        // 主要往上下走就用正面／背面的走路格，往左右走用側面
        const dir = Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy > 0 ? 'front' : 'back') : 'walk';
        if (Math.abs(dx) > 2) a.face = dx > 0 ? 1 : -1;
        a.frame = Math.floor(now / 230) % 2;
        setPose(a, dir + (a.frame ? 2 : 1));
      }
    } else if (a.mode === 'rest') {
      setPose(a, a.restPose ?? POSE[m]);
      if (now > a.until && !busy) {
        // 照顧中的那隻餓了就不去玩；其他時候偶爾去用傢俱、泡水、找夥伴玩
        const fun = m === 'hungry' ? 0 : a.p.active ? .3 : .4;
        // 先看有沒有空著的夥伴可以一起玩，再看要不要去用傢俱
        const r = Math.random();
        if (!(r < .35 && actors.length > 1 && wantFriend(a)) && !(r >= .35 && r < .35 + fun && wantUse(a))) {
          const t = somewhere(Math.random() < .6 ? a : null, a);
          a.tx = t.x; a.ty = t.y; a.mode = 'walk';
        }
      }
    }
    place(a);
  }
  raf = requestAnimationFrame(tick);
}
// 停下來時做什麼：島上的會玩、跳、打瞌睡；照顧中的看心情；下雨下雪會甩甩身體
function restPose(a) {
  const m = moodOf(a.p);
  if (m === 'hungry') return 'hungry';
  if (m === 'happy') return pick(['cheer', 'jump', 'idle']);
  const wet = sky && (sky.wx === 'rain' || sky.wx === 'snow') ? ['shake', 'shake'] : [];
  const night = sky?.tod === 'night' && !a.p.active ? ['sleep', 'sleep', 'yawn'] : [];
  return pick(['idle', 'idle', 'sit', 'look', 'sniff', 'play', 'jump', 'dig', 'roll', 'lie', 'yawn', ...wet, ...night, ...(a.p.active ? [] : ['sleep'])]);
}

// 拎起來：按住拖動；沒拖動就是點一下（選牠；選了再點＝摸摸）
// 放到傢俱上就直接用（床上躺、鞦韆坐、泳池泡水…），放進湖裡就游泳
function grab(a) {
  const el = a.el;
  el.addEventListener('pointerdown', (e) => {
    if (busy || e.button > 0) return;
    const g = $('.ground', layer).getBoundingClientRect();
    const k = g.width / GW;
    const start = { x: e.clientX, y: e.clientY, mode: a.mode };
    let held = false, ok = { x: a.x, y: a.y }, aim = null;
    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!held && Math.hypot(dx, dy) < 8) return;
      if (!held) {
        held = true;
        if (a.mode === 'use' || a.using) leave(a, null);
        start.mode = a.mode;
        a.next = null;
        el.setPointerCapture?.(e.pointerId);
        a.mode = 'held';
        el.classList.add('held');
        setPose(a, 'lift');
        a.kick = setInterval(() => setPose(a, a.pose === 'lift' ? 'lift2' : 'lift'), 380);   // 被拎著時腳晃來晃去
      }
      // 手指拎在背上，所以腳在手指下方一點
      const x = (ev.clientX - g.left) / k / GW, y = (ev.clientY - g.top) / k / GH + .05;
      a.x = Math.min(.98, Math.max(.02, x)); a.y = Math.min(.95, Math.max(.05, y));
      const can = start.mode !== 'still';
      const hit = can ? propAt(a.x, a.y - .05) ?? propAt(a.x, a.y) : null;     // 手指或腳碰到都算
      const target = hit && !hit.user ? hit : null;
      if (target !== aim) { aim?.el.classList.remove('aim'); target?.el.classList.add('aim'); aim = target; }
      const good = walkable(a.x, a.y) || !!aim || (can && inLake(a.x, a.y));
      el.classList.toggle('bad', !good);
      if (walkable(a.x, a.y)) ok = { x: a.x, y: a.y };
      place(a);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!held) { tap(a); return; }
      clearInterval(a.kick);
      el.classList.remove('held', 'bad');
      aim?.el.classList.remove('aim');
      el.classList.add('drop');
      setTimeout(() => el.classList.remove('drop'), 450);
      if (aim && !aim.user) { a.mode = 'use'; useProp(a, aim, true); return; }
      if (start.mode !== 'still' && inLake(a.x, a.y)) { a.mode = 'use'; swimLake(a, true); return; }
      if (!walkable(a.x, a.y)) { a.x = ok.x; a.y = ok.y; }
      a.tx = a.x; a.ty = a.y;
      setPose(a, 'land');
      a.mode = 'show';
      place(a);
      setTimeout(() => {
        a.mode = start.mode === 'still' ? 'still' : 'rest';
        a.until = performance.now() + rnd(1200, 2500);
        a.restPose = 'cheer';
        dress(a);
        if (a.mode === 'still') setPose(a, POSE[moodOf(a.p)]);
      }, 420);
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
    if (a.wish) say(`${WISH_TEXT[a.wish]}${USE[a.wish] || a.wish === 'lake' ? '（把我拎過去）' : ''}`, a.p.id);
    else say(pick(LINES[m === 'angry' && a.p.sulky ? 'sulky' : m] ?? LINES.normal), a.p.id);
    return;
  }
  if (a.p.active) pat();
  else if (a.wish) say(`${WISH_TEXT[a.wish]}${USE[a.wish] || a.wish === 'lake' ? '（把我拎過去）' : ''}`, a.p.id);
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

// ---------- 照顧：左上狀態卡（可以收起來）、左下夥伴、底下一排按鈕 ----------
function paintCare() {
  const box = $('aside.care', layer);
  if (!box) return;
  const p = petById(selected);
  const stamps = state.stamps ?? 0;
  const left = freeStarters();
  const locked = (state.unlock_at ?? []).filter((n) => stamps < n).slice(0, Math.max(0, left.length - (canAdopt() ? 1 : 0)));
  $('.pals-s', layer).innerHTML = state.pets.map((x) => `<button type="button" class="pal-s${x.id === selected ? ' on' : ''}${x.active ? ' care' : ''}" data-sel="${x.id}" aria-label="${esc(x.name)}${x.active ? '（照顧中）' : ''}">
      <img src="${art(x.species, x.stage)}" alt="">${x.active ? '<i>照顧中</i>' : ''}</button>`).join('')
    + (canAdopt() ? '<button type="button" class="pal-s new" data-adopt aria-label="新的時光蛋：領養一隻新夥伴"><span class="egg"></span><i>新的蛋！</i></button>' : '')
    + locked.map((n) => `<span class="pal-s locked" title="護照蓋到 ${n} 個章就能領養"><img src="${art(left[0]?.code ?? 'puppy')}" alt=""><i>${n} 個章</i></span>`).join('');
  let top = '', body = '';
  if (p?.active) {
    const m = moodOf(p);
    const pct = p.next_xp ? Math.min(100, Math.round(p.xp / p.next_xp * 100)) : 100;
    top = `<b>${esc(p.name)}</b><span class="mini-g" aria-hidden="true"><span>${pips(p.full, 'meat')}</span><span>${pips(p.joy, 'heart')}</span></span>`;
    body = `${newsHtml()}
      <p class="kind">${esc(speciesName(p.species))}・${STAGE[p.stage]}・<span class="mood m-${m}">${m === 'quiet' ? '上課時間在休息' : MOOD[m]}</span></p>
      ${gauges(p, m)}
      <div class="xp" aria-label="長大進度"><i style="width:${pct}%"></i></div>
      <small class="xpt">${p.next_xp ? `再 ${p.next_xp - p.xp} 點長成${STAGE[p.stage + 1]}（吃點心長得最快）` : '已經是完全體了！'}</small>
      ${wish()}
      <div class="nm"><button type="button" class="ghost small" data-rename>改名</button></div>`;
  } else if (p) {
    const home = myPet();
    top = `<b>${esc(p.name)}</b><small>在島上玩</small>`;
    body = `<p class="kind">${esc(speciesName(p.species))}・${STAGE[p.stage]}</p>
      <p class="lead">${esc(p.name)}在島上自己找東西吃，不用餵。可是只有「照顧中」的那一隻會長大喔。</p>
      <div class="row"><button type="button" class="btn small" data-swap="${p.id}">換牠照顧</button></div>
      ${home ? `<p class="note">換了以後，${esc(home.name)}會回到島上自己玩。</p>` : ''}`;
  }
  box.classList.toggle('open', cardOpen);
  box.innerHTML = p ? `<button type="button" class="card-top" data-card aria-expanded="${cardOpen}" aria-label="${cardOpen ? '收起' : '打開'}${esc(p.name)}的狀態">
      <img src="${art(p.species, p.stage)}" alt=""><span class="t">${top}</span><i class="tog">${cardOpen ? '收起 ▲' : '看全部 ▼'}</i></button>
    <div class="who"${cardOpen ? '' : ' hidden'}>${body}<p class="msg" hidden></p></div>` : '';
  $('[data-card]', box)?.addEventListener('click', () => { cardOpen = !cardOpen; paintCare(); });
  layer.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = () => { const a = actors.find((x) => x.p.id === +b.dataset.sel); if (a) tap(a); }; });
  $('[data-adopt]', layer)?.addEventListener('click', () => openAdopt({ more: true }));
  $('[data-rename]', box)?.addEventListener('click', rename);
  $('[data-swap]', box)?.addEventListener('click', (e) => swap(+e.currentTarget.dataset.swap, e.currentTarget));
  paintBar();
  if (bagOpen) paintBag();
}
// 底下的按鈕：餵食（打開點心列）、摸摸、丟球、傢俱。都是對「照顧中」那隻
function paintBar() {
  const bar = $('.bar', layer);
  if (!bar) return;
  const home = myPet();
  const m = home ? moodOf(home) : 'quiet';
  const furnOpen = !$('.furn', layer)?.hidden;
  bar.innerHTML = (home ? `<button type="button" class="act${bagOpen ? ' on' : ''}" data-bag ${m === 'quiet' ? 'disabled' : ''} aria-expanded="${bagOpen}"><span>🍖</span><b>餵食</b></button>
    <button type="button" class="act" data-pat ${m === 'quiet' ? 'disabled' : ''}><span>${m === 'asleep' ? '⏰' : '✋'}</span><b>${m === 'asleep' ? '叫醒牠' : '摸摸'}</b></button>
    <button type="button" class="act" data-ball><span>🎾</span><b>丟球</b></button>` : '')
    + `<button type="button" class="act${furnOpen ? ' on' : ''}" data-furn><span>🛋️</span><b>傢俱</b></button>`;
  $('[data-bag]', bar)?.addEventListener('click', () => { if (bagOpen) closeBag(); else { bagOpen = true; $('.furn', layer).hidden = true; paintBag(); paintBar(); } });
  $('[data-pat]', bar)?.addEventListener('click', () => { closeBag(); focusHome(); pat(); });
  $('[data-ball]', bar)?.addEventListener('click', () => { closeBag(); focusHome(); ballNear(); });
  $('[data-furn]', bar).onclick = toggleFurn;
}
function paintBag() {
  const pop = $('.bagpop', layer);
  const home = myPet();
  if (!pop || !home) return;
  const m = moodOf(home);
  const inv = state.inventory ?? {};
  const bag = state.items.filter((i) => i.kind === 'food' || i.facility || inv[i.code]).map((i) => {
    const n = inv[i.code] ?? 0;
    return `<button type="button" class="food${n ? '' : ' none'}" data-feed="${esc(i.code)}" ${n && m !== 'quiet' && !busy ? '' : 'disabled'}
      aria-label="餵${esc(i.name)}（還有 ${n} 個）"><span class="ic">${icon(i)}</span><b>${esc(i.name)}</b><small>× ${n}</small></button>`;
  }).join('');
  pop.innerHTML = `<p>點一下拿去餵${esc(home.name)}</p><div class="bag">${bag}</div>`;
  pop.hidden = false;
  pop.querySelectorAll('[data-feed]').forEach((b) => { b.onclick = () => { closeBag(); focusHome(); feed(b.dataset.feed); }; });
}
function closeBag() {
  if (!bagOpen) return;
  bagOpen = false;
  const pop = $('.bagpop', layer);
  if (pop) pop.hidden = true;
  paintBar();
}
// 按底下按鈕時，狀態卡換回照顧中那隻
function focusHome() {
  const home = myPet();
  if (!home || selected === home.id) return;
  selected = home.id;
  actors.forEach(dress);
  paintCare();
}
// 丟球按鈕：丟到照顧中那隻附近的空地
function ballNear() {
  const a = actors.find((x) => x.p.active);
  if (!a) return;
  if (!free(a) && a.mode !== 'use') { say(['asleep', 'quiet'].includes(moodOf(a.p)) ? 'Zzz…' : pick(['現在不想玩…', '等一下再玩嘛']), a.p.id); return; }
  for (let k = 0; k < 40; k++) {
    const ang = Math.random() * Math.PI * 2, d = rnd(.12, .22);
    const at = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d * .6 };
    if (walkable(at.x, at.y)) { throwBall(at); return; }
  }
  throwBall(somewhere(a));
}
function oops(msg) {
  const m = $('aside.care .msg', layer);
  if (m && cardOpen) { m.textContent = msg; m.hidden = false; return; }
  const home = myPet();
  if (home) say(msg, home.id);
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
  if (a.mode === 'use' || a.using || a.next) leave(a);
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
    if (a.mode === 'use' || a.using || a.next) leave(a);
    const was = a.mode;
    refresh(r);
    say(reply(r, a.p, null), a.p.id);
    if (r.tired) { say(pick(['嘿嘿，摸好多次了～換個方式陪我玩嘛（丟球、幫我完成願望）', '好舒服…可是我想玩丟球！']), a.p.id); }
    if (['normal', 'happy'].includes(a.p.mood) && !['hungry', 'asleep'].includes(r.was)) {
      a.mode = 'show';
      ['pat', 'jump', 'cheer', 'jump'].forEach((pose, k) => setTimeout(() => setPose(a, pose), k * 380));
      for (let k = 0; k < (r.tired ? 1 : 3); k++) setTimeout(() => floatUp(a, k === 0 && r.xp ? `♥ +${r.xp}` : '♥'), k * 300);
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
