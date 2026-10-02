// 樂園大門：開場畫面 → 島嶼地圖 → 島的介紹卡 → 進入設施（遊戲）。
// 地圖上有哪些島、島上有哪些設施、能不能進，全部從 data/park.json 讀（之後改成資料庫）。
import { addUnits } from './units.js';
import * as account from './account.js';
import * as pet from './pet.js';
import { facilityStatus } from './auth.js';
import * as snd from './audio.js';

// 測試站在 /dev/ 底下：顯示「測試站」標籤，設施連到各遊戲的測試站
const IS_DEV = /^\/dev(\/|$)/.test(location.pathname);

const STATUS = {
  open:         { label: '開放中', canEnter: true },
  trial:        { label: '試營運', canEnter: false, note: '只開放給試玩班，登入功能做好後才能進入。' },
  construction: { label: '施工中', canEnter: false, note: '還在施工，即將開幕！' },
  maintenance:  { label: '維修中', canEnter: false, note: '暫停營業，修好就會重新開放。' },
  hidden:       { label: '雲霧',   canEnter: false },
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;

// 先問「我是誰」，跟讀地圖資料同時進行
const meReady = account.init((w) => onAccountChange(w));
const park = await fetch('data/park.json', { cache: 'no-cache' }).then((r) => r.json());
const zones = new Map(park.zones.filter((z) => z.status !== 'hidden').map((z) => [z.code, z]));
const facilitiesOf = (code) => park.facilities.filter((f) => f.zone === code && f.status !== 'hidden');
const MAP_W = park.map.width;

// 設施狀態以資料庫為準（管理員在老師後台切換，不用重新部署），連不上就照 park.json。
// 學生登入時還會帶回 mine：自己的班有沒有開放這個設施。
async function syncFacilities() {
  const live = await facilityStatus();
  if (!live) return;
  for (const f of park.facilities) {
    const l = live.get(f.code);
    if (!l) { f.status = 'hidden'; continue; }
    Object.assign(f, { status: l.status, grade_min: l.grade_min, grade_max: l.grade_max,
                       url: l.url ?? f.url, url_dev: l.url_dev ?? f.url_dev, mine: l.mine });
  }
}

if (IS_DEV) $('#env-tag').hidden = false;

// ---------- 玩法、挑戰度、狀態、連結 ----------
// 小朋友看到的只有玩法類型和挑戰星等；科目、年級只放老師後台，免得一看就覺得是功課。
function starsHtml(n) {
  if (!n) return '';
  return `<span class="chip stars" title="挑戰度">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
}
function facilityUrl(f) {
  return (IS_DEV ? f.url_dev : f.url) || null;
}
// 島的名牌下面那行：玩法類型，或島的狀態（施工中、維修中、試營運）
function zoneSub(z) {
  return z.status === 'open' ? z.subtitle : `${z.subtitle}・${STATUS[z.status]?.label ?? ''}`;
}

// ---------- 島 ----------
function buildIsle(btn, z) {
  // 網址要換成絕對路徑，不然 CSS 會從 css/ 資料夾去找圖
  btn.style.setProperty('--img', `url("${new URL(z.art, location.href).href}")`);
  btn.classList.add('st-' + z.status);
  btn.setAttribute('aria-label', `${z.name}（${zoneSub(z)}）`);
  btn.innerHTML = `<div class="bob"><div class="lift"><div class="foam"></div><div class="shadow"></div><img class="art" src="${esc(z.art)}" alt=""><div class="sink"></div><img class="spark" src="img/fx/sparkle.webp" alt=""></div></div>`;
  if (z.status === 'trial') btn.querySelector('.lift').insertAdjacentHTML('beforeend', '<span class="flag">試營運</span>');
  if (z.status === 'maintenance') btn.querySelector('.lift').insertAdjacentHTML('beforeend', '<span class="flag maint">維修中</span>');
  addUnits(btn.querySelector('.lift'), z.units);
  btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hoverSound(); });
  return btn;
}

function buildMist(btn) {
  btn.classList.add('mist');
  btn.setAttribute('aria-label', '尚未發現的島嶼');
  btn.innerHTML = `<div class="cloud"><i></i><i></i><i></i><i></i><span class="q">?</span></div><div class="plate"><b>尚未發現的島嶼</b></div>`;
  return btn;
}

// 開場：固定構圖，資料裡沒有（或被隱藏）的島就不畫
document.querySelectorAll('#title .isle').forEach((b) => {
  const z = zones.get(b.dataset.zone);
  if (!z) return b.remove();
  buildIsle(b, z);
  b.addEventListener('click', () => $('#start').click());
});

// 地圖：每個 slot 放一座島，沒有島的 slot 放雲霧
const islesLayer = $('#isles');
$('#map').style.width = MAP_W + 'px';
const bySlot = new Map([...zones.values()].map((z) => [z.slot, z]));
park.map.slots.forEach((s, i) => {
  const b = document.createElement('button');
  b.className = 'isle';
  b.style.cssText = `left:${s.left}px;top:${s.top}px;width:${s.width}px;--in:${(i * .05).toFixed(2)}s;--delay:${-i * 1.3}s`;
  const z = bySlot.get(s.slot);
  if (z) {
    buildIsle(b, z);
    b.insertAdjacentHTML('beforeend', `<div class="plate"><b>${esc(z.name)}</b><span>${esc(zoneSub(z))}</span></div>`);
    b.addEventListener('click', () => !dragged && openCard(z));
  } else {
    buildMist(b);
    b.addEventListener('click', () => {
      if (dragged) return;
      puff(b);
      snd.sfx('SE-13');
      say('map', '雲霧後面還藏著新的島，探險隊正在開路，很快就會出現！');
    });
  }
  islesLayer.appendChild(b);
});

// ---------- 主島桌寵：坐在樂園村莊上（js/pet.js） ----------
pet.init({ me: () => account.current(), host: () => islesLayer, dragged: () => dragged });

// ---------- 海上的小裝飾（燈塔、礁石、海豚…），位置寫在 data/park.json ----------
const decorLayer = $('#decor');
(park.decor ?? []).forEach((d, i) => {
  const el = document.createElement('div');
  el.className = 'decor ' + (d.anim ?? '');
  el.style.cssText = `left:${d.left}px;top:${d.top}px;width:${d.width}px;--delay:${-i * 1.7}s`;
  el.innerHTML = `<img src="${esc(d.img)}" alt="">`;
  decorLayer.appendChild(el);
});

// ---------- 特效 ----------
function fxAt(host, src, cls, x, y, w) {
  const img = document.createElement('img');
  img.src = src; img.alt = ''; img.className = 'fx ' + cls;
  img.style.cssText = `left:${x}px;top:${y}px;width:${w}px`;
  host.appendChild(img);
  img.addEventListener('animationend', () => img.remove());
}
function puff(btn) {
  fxAt(btn.parentElement, 'img/fx/smoke.webp', 'puff', btn.offsetLeft + btn.offsetWidth / 2, btn.offsetTop + btn.offsetWidth * .3, btn.offsetWidth * 1.1);
}

// ---------- 導覽員滴答 ----------
// 右下角的小幫手：進地圖打招呼、點雲霧會解釋、點他會輪流講提示
const TICK_TIPS = [
  ['point', '點一座島，看看島上有什麼好玩的！'],
  ['map', '守護異世界的怪物最怕單字咒語，會的咒語越多越厲害！'],
  ['fly-happy', '地圖可以往右拖，那邊還有雲霧裡的島。'],
  ['jump', '還在施工的島，蓋好就會開放，敬請期待！'],
  ['cheer', '在遊戲裡完成任務會蓋護照章，左下角的護照可以看你蓋了哪些！'],
  ['happy', '樂園村莊住著你的桌寵，記得回來餵牠！各島蓋到章還會拿到點心喔。'],
];
let tipIndex = 0, sayTimer;
function say(pose, text) {
  $('#tick-img').src = `img/tick/${pose}.webp`;
  const bubble = $('#tick-say');
  bubble.hidden = false;
  bubble.textContent = text;
  bubble.style.animation = 'none'; void bubble.offsetWidth; bubble.style.animation = '';
  const btn = $('#tick-btn');
  btn.classList.remove('boing'); void btn.offsetWidth; btn.classList.add('boing');
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { bubble.hidden = true; $('#tick-img').src = 'img/tick/fly.webp'; }, 7000);
}
$('#tick-btn').addEventListener('click', () => {
  snd.sfx('SE-14');
  const [pose, text] = TICK_TIPS[tipIndex++ % TICK_TIPS.length];
  say(pose, text);
});

// ---------- 船 ----------
const BOATS = [
  { img: 'img/boat1.webp', y: 690, speed: 38, w: 92, x: 300 },
  { img: 'img/boat2.webp', y: 560, speed: 22, w: 78, x: 1100 },
  { img: 'img/boat3.webp', y: 290, speed: 30, w: 84, x: 900, dir: 1 },
  { img: 'img/boat3.webp', y: 830, speed: 26, w: 96, x: 1400 },
];
const fleets = [...document.querySelectorAll('.boats')].map((layer) => {
  const span = layer.closest('#map') ? MAP_W : 1600;
  const boats = layer.closest('#map') && MAP_W > 1600
    ? [...BOATS, { img: 'img/boat2.webp', y: 470, speed: 28, w: 84, x: 1900, dir: 1 }]
    : BOATS;
  return boats.map((b) => {
    const el = document.createElement('div');
    el.className = 'boat';
    el.style.width = b.w + 'px';
    el.innerHTML = `<div class="wake"></div><img src="${b.img}" alt="">`;
    layer.appendChild(el);
    return { ...b, el, span, dir: b.dir || -1 };
  });
});
let last = performance.now();
function tick(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  for (const fl of fleets) for (const b of fl) {
    if (!reduceMotion) b.x += b.dir * b.speed * dt;
    if (b.x < -140) b.x = b.span + 140;
    if (b.x > b.span + 140) b.x = -140;
    b.el.style.transform = `translate(${b.x}px,${b.y}px) scaleX(${b.dir > 0 ? -1 : 1})`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- 舞台縮放、視差、地圖左右移動 ----------
const world = $('#world'), stage = $('#stage'), mapEl = $('#map');
let scale = 1, pan = 0;
function panRange() {
  const visible = innerWidth / scale;               // 畫面看得到幾個舞台單位寬
  if (visible >= MAP_W) { const c = MAP_W / 2 - 800; return [c, c]; }
  return [visible / 2 - 800, MAP_W - visible / 2 - 800];
}
function setPan(v) {
  const [lo, hi] = panRange();
  pan = Math.max(lo, Math.min(hi, v));
  mapEl.style.setProperty('--pan', pan);
  $('#pan-l').hidden = pan <= lo + 1;
  $('#pan-r').hidden = pan >= hi - 1;
}
function fit() {
  scale = Math.min(innerWidth / 1600, innerHeight / 900);
  stage.style.setProperty('--s', scale);
  setPan(pan);
}
addEventListener('resize', fit);
fit();
setPan(panRange()[0]);
world.addEventListener('pointermove', (e) => {
  world.style.setProperty('--px', ((e.clientX / innerWidth - .5) * 2).toFixed(3));
  world.style.setProperty('--py', ((e.clientY / innerHeight - .5) * 2).toFixed(3));
});

// 拖曳地圖（滑鼠或手指），移動超過一點點就不算點擊
let drag = null, dragged = false;
const select = $('#select');
select.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.topbar,.pan')) return;
  drag = { x: e.clientX, pan, id: e.pointerId };
  dragged = false;
});
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  if (!dragged && Math.abs(dx) > 8) { dragged = true; mapEl.classList.add('dragging'); }
  if (dragged) setPan(drag.pan - dx / scale);
});
addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  mapEl.classList.remove('dragging');
  setTimeout(() => { dragged = false; }, 0);
});
select.addEventListener('wheel', (e) => {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  mapEl.classList.add('dragging');
  setPan(pan + d / scale);
  clearTimeout(select._w);
  select._w = setTimeout(() => mapEl.classList.remove('dragging'), 120);
}, { passive: true });
$('#pan-l').addEventListener('click', () => setPan(pan - 600));
$('#pan-r').addEventListener('click', () => setPan(pan + 600));

// ---------- 聲音（js/audio.js） ----------
// 一般按鈕都「啵」一下；有自己聲音的（Start、島、關閉、滴答、進設施、喇叭）在各自的地方放
const OWN_SOUND = '#start,.isle,#close,.x,#tick-btn,a.btn.go,#snd-btn,[data-close],[data-save]';
document.addEventListener('click', (e) => {
  const b = e.target.closest('button,a.btn');
  if (b && !b.disabled && !b.closest(OWN_SOUND)) snd.sfx('SE-01');
}, true);
let hoverAt = 0;
function hoverSound() {
  const now = performance.now();
  if (now - hoverAt > 350) { hoverAt = now; snd.sfx('SE-11'); }
}
// 左下角的喇叭：全開 → 只有音效 → 全關
const SND_LABEL = { all: '聲音全開', sfx: '只有音效', off: '聲音關' };
const sndBtn = $('#snd-btn');
function paintSnd() {
  const m = snd.getMode();
  sndBtn.dataset.mode = m;
  sndBtn.querySelector('b').textContent = SND_LABEL[m];
  sndBtn.setAttribute('aria-label', `${SND_LABEL[m]}，點一下切換`);
}
sndBtn.addEventListener('click', () => {
  const next = { all: 'sfx', sfx: 'off', off: 'all' }[snd.getMode()];
  snd.setMode(next);
  paintSnd();
  snd.sfx('SE-01');
});
paintSnd();
snd.preload(['SE-01', 'SE-02', 'SE-03', 'SE-10', 'SE-11', 'SE-12', 'SE-14', 'SE-15']);

// ---------- 換場 ----------
const title = $('#title'), flash = $('#flash');
function showTitle() {
  closeCard();
  snd.music('MU-01'); snd.ambience('SE-16');
  select.hidden = true;
  title.hidden = false;
}
function greeting() {
  const w = account.current();
  const fresh = w.profile?.unseen ?? [];
  if (w.kind === 'student' && fresh.length) {
    return `哇！${w.nickname}，你拿到新的護照章「${fresh[fresh.length - 1].name}」${fresh.length > 1 ? `等 ${fresh.length} 個` : ''}！點左下角的護照看看。`;
  }
  const petNews = w.kind === 'student' ? pet.notice() : null;
  if (petNews) return petNews;
  const name = w.kind === 'student' ? w.nickname : w.kind === 'staff' ? w.display_name : '';
  return name ? `嗨，${name}！歡迎來到時空冒險樂園，點一座島看看吧。` : '嗨，我是滴答！歡迎來到時空冒險樂園，點一座島看看吧。';
}
function showMap({ animate = true } = {}) {
  title.hidden = true;
  select.hidden = false;
  paintPassBtn();
  snd.music('MU-01'); snd.ambience('SE-16');
  const stamped = account.current().profile?.unseen?.length;
  snd.sfx('SE-15');
  if (stamped) setTimeout(() => snd.sfx('SE-19'), 700);
  say(stamped ? 'cheer' : 'wave', greeting());
  if (animate) {
    select.classList.add('entering');
    setTimeout(() => select.classList.remove('entering'), 1400);
  }
}
function go() {
  if (title.classList.contains('leaving')) return;
  title.classList.add('leaving');
  flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
  setTimeout(() => {
    title.classList.remove('leaving');
    history.replaceState(null, '', '#map');
    showMap();
  }, reduceMotion ? 0 : 520);
}
// 進樂園要先登入（帳號功能載入失敗時照樣放行，地圖本身不需要資料庫）
$('#start').addEventListener('click', async () => {
  const b = $('#start');
  snd.sfx('SE-10');
  fxAt(title, 'img/fx/star-burst.webp', 'burst', b.offsetLeft, b.offsetTop + b.offsetHeight / 2, 420);
  const w = await account.requireLogin();
  if (w || !account.available) go();
});
$('#back').addEventListener('click', () => { history.replaceState(null, '', location.pathname); showTitle(); });

// ---------- 介紹卡 ----------
const veil = $('#veil'), toast = $('#toast');
function facilityHtml(f, z) {
  const st = STATUS[f.status] ?? STATUS.construction;
  const url = facilityUrl(f);
  const w = account.current();
  let can = st.canEnter, note = st.note;
  if (f.status === 'trial') {
    can = f.mine === true || (w.kind === 'staff' && w.is_admin);
    if (!can) note = '只開放給試玩班。';
  } else if (f.status === 'open' && f.mine === false) {
    can = false;
    note = '你的班還沒有開放這個遊戲，請問問老師。';
  }
  const chips = [
    f.genre && `<span class="chip">${esc(f.genre)}</span>`,
    starsHtml(f.stars),
    `<span class="chip ${f.status}">${st.label}</span>`,
  ].filter(Boolean).join('');
  const action = can && url
    ? `<a class="btn go" href="${esc(url)}">開始冒險</a>`
    : `<span class="note"><img src="img/ui/lock.webp" alt="">${esc(note ?? '還不能進入。')}</span>`;
  const head = f.name === z.name ? '' : `<h3>${esc(f.name)}</h3>`;
  return `<div class="fac">${head}<div class="chips">${chips}</div><p>${esc(f.description)}</p><div class="row">${action}</div></div>`;
}
// 卡片底下滴答說的話：能玩就興奮，還不能玩就說明原因
function tickLine(facs) {
  const open = facs.some((f) => (f.status === 'open' ? f.mine !== false : f.status === 'trial' && f.mine === true) && facilityUrl(f));
  if (open) return ['excited', '準備好了嗎？按「開始冒險」出發！'];
  if (facs.some((f) => f.status === 'maintenance')) return ['worried', '這裡暫時在維修，修好就能玩了。'];
  if (facs.some((f) => f.status === 'open' && f.mine === false)) return ['thinking', '請老師在後台幫你的班打開這個遊戲喔！'];
  return ['thinking', '這裡還在施工，蓋好了我第一個通知你！'];
}
// 樂園村莊沒有遊戲，是放自己東西的地方：護照、頭像、我的資料
function villageHtml() {
  const w = account.current();
  if (w.kind !== 'student') {
    return `<div class="fac"><h3>樂園護照</h3><p>小朋友在各遊戲完成任務，就會在護照上蓋章；蓋越多章，可以選的頭像越多。${w.kind === 'staff' ? '老師可以在後台的全班總覽看到每個學生蓋了幾個章。' : ''}</p></div>`;
  }
  const p = w.profile;
  return `<div class="fac"><h3>我的護照與頭像</h3>
    <div class="row">${account.avatarHtml(p?.avatar, p?.frame, 'mid')}<p>${p ? `你已經蓋了 <b>${p.stamps}</b> 個章。` : ''}在遊戲裡完成任務就會蓋章，蓋越多章，可以選的頭像和頭像框越多。</p></div>
    <div class="row"><button type="button" class="btn go" data-open-pass>打開護照</button><button type="button" class="ghost" data-open-av>換頭像</button></div></div>
    <div class="fac"><h3>我的桌寵</h3><p>你的桌寵住在村莊裡。牠會肚子餓，記得常回來餵牠、陪牠玩；在各島完成任務還會拿到牠最愛的點心。</p>
    <div class="row"><button type="button" class="btn go" data-open-pet>去看桌寵</button></div></div>`;
}
function openCard(z) {
  const facs = facilitiesOf(z.code);
  const village = z.code === 'village';
  const [face, line] = village ? ['happy', '護照上的章，是你在每座島上的冒險紀錄喔！'] : tickLine(facs);
  veil.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="${esc(z.name)}">
    <button class="x" id="close" aria-label="關閉，回到地圖"></button>
    <div class="art"><img src="${esc(z.art)}" alt="">${z.badge ? `<img class="badge" src="${esc(z.badge)}" alt="">` : ''}</div>
    <div><h2>${esc(z.name)}</h2><p class="lead">${esc(z.description)}</p>
    ${village ? villageHtml() : facs.length ? facs.map((f) => facilityHtml(f, z)).join('') : '<p class="lead">島上的設施還在規劃。</p>'}
    <div class="say"><img src="img/tick/${face}.webp" alt="滴答"><p>${line}</p></div></div></div>`;
  veil.hidden = false;
  snd.sfx('SE-03');
  history.replaceState(null, '', '#map/' + z.code);
  $('#close').onclick = closeCard;
  veil.querySelectorAll('a.btn.go').forEach((a) => a.addEventListener('click', enterFacility));
  veil.querySelector('[data-open-pass]')?.addEventListener('click', () => { closeCard(); account.openPassport(); });
  veil.querySelector('[data-open-av]')?.addEventListener('click', () => { closeCard(); account.openAvatar(); });
  veil.querySelector('[data-open-pet]')?.addEventListener('click', () => { closeCard(); pet.open(); });
  (veil.querySelector('.card .btn') ?? $('#close')).focus();
}
// 進設施：時空傳送門轉一圈再換頁
function enterFacility(e) {
  if (reduceMotion || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  snd.sfx('SE-12');
  const href = e.currentTarget.href;
  const p = document.createElement('div');
  p.id = 'portal';
  p.innerHTML = '<img src="img/fx/portal.webp" alt="">';
  stage.appendChild(p);
  setTimeout(() => { location.href = href; }, 1000);
}
// 從遊戲按上一頁回來時，把傳送門收掉
addEventListener('pageshow', () => document.getElementById('portal')?.remove());
function closeCard() {
  if (veil.hidden) return;
  snd.sfx('SE-02');
  veil.hidden = true;
  veil.innerHTML = '';
  if (!select.hidden) history.replaceState(null, '', '#map');
}
veil.addEventListener('click', (e) => { if (e.target === veil) closeCard(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
let tt;
function showToast(t) {
  toast.textContent = t;
  toast.hidden = false;
  clearTimeout(tt);
  tt = setTimeout(() => { toast.hidden = true; }, 2600);
}

// ---------- 左下角的護照（學生才有） ----------
const passBtn = $('#pass-btn');
function paintPassBtn() {
  const w = account.current();
  passBtn.hidden = w.kind !== 'student';
  const n = w.profile?.unseen?.length ?? 0;
  const dot = passBtn.querySelector('.dot');
  dot.hidden = !n;
  dot.textContent = n;
  passBtn.classList.toggle('wiggle', n > 0);
}
passBtn.addEventListener('click', () => account.openPassport());
addEventListener('park:profile', paintPassBtn);

// ---------- 從網址決定一開始的畫面 ----------
// 遊戲裡的「回樂園」按鈕連到 /#map，直接回到島嶼地圖、不用再看一次開場
const [, route, zoneCode] = location.hash.match(/^#(map)(?:\/([\w-]+))?/) ?? [];
// 登出了就回到開場
function onAccountChange(w) {
  syncFacilities();
  paintPassBtn();
  pet.load();
  if (w.kind === 'guest' && !select.hidden) { history.replaceState(null, '', location.pathname); showTitle(); }
}
const me = await meReady;
await Promise.all([syncFacilities(), pet.load()]);
if (route && me.kind === 'guest') {
  // 從遊戲回來但已經登出（或換人用平板）：先回開場，按 Start 再登入
  history.replaceState(null, '', location.pathname);
  title.hidden = false;
} else if (route) {
  showMap({ animate: false });
  const z = zones.get(zoneCode);
  if (z) {
    const s = park.map.slots.find((x) => x.slot === z.slot);
    if (s) setPan(s.left + s.width / 2 - 800);
    openCard(z);
  }
} else {
  title.hidden = false;
  if (account.hasJoinLink && me.kind === 'guest') $('#start').click();   // 老師分享的「帶代碼連結」
  const staff = new URLSearchParams(location.search).get('staff');
  if (staff !== null && account.available) {                                // 老師後台的「建立開班帳號」
    if (me.kind === 'staff') location.replace('teacher.html');
    else account.openStaffPanel(staff);
  }
}
snd.music('MU-01'); snd.ambience('SE-16');
$('#loading').remove();
