// 寵物島 C 期的三個小遊戲：釣魚（池塘碼頭）、澆果樹（果樹傢俱）、烤點心（烤點心爐）。
// 規劃 doc「寵物島 2.0 通盤規劃」；資料庫在 supabase/park_pet.sql 的 5b 段（park_pet_fish / water / harvest / bake）。
// 不換頁：在寵物島上開一個大窗（手機全螢幕），玩完窗戶收起來、拿到的東西進背包。
// 不限次數（2026-10-30 Chuck），但果樹一天只能澆一次、釣魚一天最多 10 個時光幣。
//
// ctx（js/pet.js 給的）：{ host, api, state()（目前的 park_pet_state）, refresh(s), has(species), say(text), onClose() }

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const TREES = { orange: '橘子樹', apple: '蘋果樹', mango: '芒果樹' };
export const FRUIT = { orange: '橘子', apple: '蘋果', mango: '芒果' };
// 食譜：兩樣材料 → 點心（吃了 2 小時的能力）
export const RECIPES = [
  { code: 'bake-orange', name: '橘子小蛋糕', need: { 'fruit-orange': 2 }, buff: '跑得快' },
  { code: 'bake-apple', name: '蘋果派', need: { 'fruit-apple': 2 }, buff: '跳得高' },
  { code: 'bake-mango', name: '芒果布丁', need: { 'fruit-mango': 2 }, buff: '心情超好' },
  { code: 'bake-fish', name: '鮮魚餅乾', need: { 'fish-s': 2 }, buff: '游得快' },
];
export const BUFF = { run: '⚡ 跑得快', jump: '🦘 跳得高', happy: '💖 心情超好', swim: '🌊 游得快' };
const NAME = { 'fish-s': '小溪魚', 'fish-m': '胖胖魚', 'fish-l': '大鯉魚', 'fish-night': '夜光魚',
               'fruit-orange': '橘子', 'fruit-apple': '蘋果', 'fruit-mango': '芒果', seeds: '葵花子' };
const img = (code) => `img/pet/food/${code}.webp`;
// 樹長到哪：0、1 小樹苗，2 開花，3 結果
export const treeStage = (grow) => (grow >= 3 ? 3 : grow >= 2 ? 2 : 1);

let ctx = null, pop = null, timers = [], alive = 0;
const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
function close() {
  timers.forEach(clearTimeout);
  timers = [];
  alive++;
  pop?.remove();
  pop = null;
  ctx?.onClose?.();
}
function frame(cls, title, body) {
  pop?.remove();
  timers.forEach(clearTimeout);
  timers = [];
  alive++;
  pop = document.createElement('div');
  pop.className = 'pg-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', title);
  pop.innerHTML = `<div class="pg ${cls}"><button class="x" data-pg-x aria-label="關閉，回到寵物島"></button>
    <h2>${title}</h2>${body}</div>`;
  ctx.host.appendChild(pop);
  $('[data-pg-x]', pop).onclick = close;
  return pop;
}
// 左下的目標（照進場引導原則：一句話、動詞開頭）
function goal(text, hot = false) {
  const g = pop && $('.pg-goal', pop);
  if (!g) return;
  g.textContent = text;
  g.classList.toggle('hot', hot);
}
function got(html, ms = 1600) {
  const el = pop && $('.pg-got', pop);
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  later(() => { el.hidden = true; }, ms);
}

// ---------- 釣魚 ----------
// 等浮標沉下去 → 按住「拉！」→ 量表的指針上下跑，在綠色區放開就釣到。連續釣到越來越大條。
// 連續釣到：綠色區一條比一條小（22% → 每條少 12%，最小 10%），指針也跑快一點；沒釣到就回到最簡單。
// 小貓：綠色區放大 30%、魚上鉤停久一點，畫面上一直看得到加成；石虎：晚上會釣到夜光魚（伺服器決定）。
export function openFish(c) {
  ctx = c;
  const kitten = ctx.has('kitten');
  frame('pg-fish', '池塘釣魚', `
    <div class="pf-stage"><img class="bg" src="img/pet/game/pond.webp" alt="">
      <div class="pf-bob"><img src="img/pet/game/bobber.webp" alt=""><i class="ring"></i><b class="bang" hidden>！</b></div>
      <div class="pf-meter" hidden><i class="zone"></i><i class="nail"></i></div>
      <p class="pf-streak"></p>
      ${kitten ? '<p class="pf-buff">🐱 小貓加成：成功區間放大 30%</p>' : ''}
      <div class="pg-got" hidden></div>
    </div>
    <p class="pg-goal" aria-live="polite"></p>
    <button type="button" class="btn pf-pull" data-pull>拉！</button>
    ${kitten ? '<p class="pg-help">🐱 小貓也讓魚上鉤停比較久</p>' : ''}`);
  const me = alive;
  const bob = $('.pf-bob', pop), meter = $('.pf-meter', pop), zone = $('.zone', meter), nail = $('.nail', meter), btn = $('[data-pull]', pop);
  let phase = 'wait', streak = 0, biteAt = 0, hold = null, z0 = 0, z1 = 0;
  const BITE = kitten ? 2000 : 1300, BOOST = kitten ? 1.3 : 1;
  // 第幾條就多難：綠色區大小（小貓再放大 30%）、指針跑一趟要多久
  const zoneFor = (n) => Math.max(.1, .22 * (1 - .12 * Math.min(n, 5))) * BOOST;
  const speedFor = (n) => Math.max(950, 1500 - 110 * Math.min(n, 5));
  const size = () => (streak >= 4 ? 3 : streak >= 2 ? 2 : 1);
  const paintStreak = () => { $('.pf-streak', pop).textContent = streak ? `連續釣到 ${streak} 條！${size() === 3 ? '大魚來了，' : size() === 2 ? '魚變大了，' : ''}綠色區變小囉` : ''; };
  function cast() {
    if (me !== alive) return;
    phase = 'wait';
    meter.hidden = true;
    bob.className = 'pf-bob cast';
    $('.bang', bob).hidden = true;
    goal('等浮標沉下去，再按住「拉！」');
    later(bite, rnd(1500, 4200));
  }
  function bite() {
    if (me !== alive || phase !== 'wait') return;
    phase = 'bite';
    biteAt = performance.now();
    bob.className = 'pf-bob bite';
    $('.bang', bob).hidden = false;
    goal('魚上鉤了！快按住「拉！」', true);
    navigator.vibrate?.(40);
    later(() => { if (phase === 'bite') miss('魚跑掉了…下次早一點按'); }, BITE);
  }
  function miss(text) {
    phase = 'miss';
    streak = 0;
    paintStreak();
    bob.className = 'pf-bob';
    meter.hidden = true;
    got(`<b>${text}</b>`, 1300);
    later(cast, 1400);
  }
  function press(e) {
    e?.preventDefault();
    if (phase === 'wait') { goal('還沒！等浮標沉下去再按'); return; }
    if (phase !== 'bite') return;
    phase = 'reel';
    // 綠色區隨機放在量表的中上段
    const Z = zoneFor(streak), SPEED = speedFor(streak);
    z0 = rnd(.3, .92 - Z); z1 = z0 + Z;
    zone.style.cssText = `bottom:${z0 * 100}%;height:${Z * 100}%`;
    meter.classList.toggle('boost', kitten);
    meter.hidden = false;
    bob.className = 'pf-bob reel';
    goal('指針跑到綠色的地方就放開', true);
    const t0 = performance.now();
    hold = { v: 0 };
    const step = () => {
      if (phase !== 'reel' || me !== alive) return;
      const t = ((performance.now() - t0) / SPEED) % 2;
      hold.v = t < 1 ? t : 2 - t;
      nail.style.bottom = `${hold.v * 100}%`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  async function release(e) {
    e?.preventDefault();
    if (phase !== 'reel') return;
    const v = hold?.v ?? 0;
    if (v < z0 || v > z1) { miss(v < z0 ? '太早放開，魚溜走了' : '拉太久，線斷了'); return; }
    phase = 'busy';
    streak++;
    const s = size();
    let r;
    try { r = await ctx.api.fish(s); } catch (err) { if (me === alive) miss(err.message); return; }
    if (me !== alive) return;
    ctx.refresh(r);
    paintStreak();
    bob.className = 'pf-bob';
    meter.hidden = true;
    got(`<img src="${img(r.item)}" alt=""><b>釣到${NAME[r.item] ?? '魚'}！</b>${r.coins ? `<small>＋${r.coins} 時光幣</small>` : ''}${r.item === 'fish-night' ? '<small>石虎說：晚上才有喔！</small>' : ''}`, 1800);
    later(cast, 1900);
  }
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // 鍵盤：空白鍵按住
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) press(e); });
  btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(e); });
  paintStreak();
  later(cast, 500);
}

// ---------- 澆果樹 ----------
// 熟了就直接收成；今天澆過了就說明天再來；不然玩「接雨滴、趕毛毛蟲」：接到 8 滴、蟲都趕走就澆好了。
export function openWater(c, tree) {
  ctx = c;
  const t = ctx.state().trees?.[tree] ?? { grow: 0, watered: false };
  const stage = treeStage(t.grow);
  const left = Math.max(0, 3 - t.grow);
  const head = `<div class="pw-stage"><img class="tree" src="img/pet/farm/${tree}-${stage}.webp" alt="">
      <div class="pw-fx"></div><div class="pg-got" hidden></div></div>
    <p class="pw-grow">${'🌱'.repeat(Math.min(3, t.grow))}${'⚪'.repeat(left)}<small>${t.grow >= 3 ? '結果子了！' : `再澆 ${left} 天就會結果`}</small></p>
    <p class="pg-goal" aria-live="polite"></p>`;
  if (t.grow >= 3) {
    frame('pg-water', TREES[tree], `${head}<button type="button" class="btn" data-reap>收成${FRUIT[tree]}！</button>`);
    goal(`點「收成${FRUIT[tree]}」`);
    $('[data-reap]', pop).onclick = (e) => reap(tree, e.currentTarget);
    return;
  }
  if (t.watered) {
    frame('pg-water', TREES[tree], `${head}<button type="button" class="btn" data-pg-ok>好</button>`);
    goal('今天喝飽了，明天再來澆水');
    $('[data-pg-ok]', pop).onclick = close;
    return;
  }
  frame('pg-water', TREES[tree], `${head}<div class="pw-bar"><i></i></div>`);
  playRain(tree);
}
function playRain(tree) {
  const me = alive, fx = $('.pw-fx', pop), bar = $('.pw-bar i', pop);
  const NEED = 8;
  let drops = 0, bugs = 0, done = false;
  goal('點掉下來的雨滴，接 8 滴給果樹喝');
  const paint = () => { bar.style.width = `${Math.min(100, drops / NEED * 100)}%`; };
  function finish() {
    if (done || drops < NEED || bugs > 0) return;
    done = true;
    goal('澆好了！');
    water(tree);
  }
  function drop() {
    if (me !== alive || done) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pw-drop';
    el.setAttribute('aria-label', '雨滴');
    el.innerHTML = '<img src="img/pet/game/drop.webp" alt="">';
    el.style.left = `${rnd(12, 82)}%`;
    el.style.animationDuration = `${rnd(2.2, 3.2)}s`;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (el.dataset.hit) return;
      el.dataset.hit = 1;
      el.classList.add('hit');
      drops++;
      paint();
      if (drops >= NEED && bugs) goal('還有毛毛蟲在吃葉子，點牠趕走！', true);
      later(() => el.remove(), 300);
      finish();
    });
    el.addEventListener('animationend', () => el.remove());
    fx.appendChild(el);
    later(drop, rnd(450, 800));
  }
  function bug() {
    if (me !== alive || done) return;
    if (bugs < 2) {
      bugs++;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pw-bug';
      el.setAttribute('aria-label', '毛毛蟲');
      el.innerHTML = '<img src="img/pet/game/bug.webp" alt="">';
      el.style.left = `${rnd(30, 62)}%`;
      el.style.top = `${rnd(28, 55)}%`;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (el.dataset.hit) return;
        el.dataset.hit = 1;
        el.classList.add('hit');
        bugs--;
        later(() => el.remove(), 400);
        if (drops < NEED) goal('趕走了！繼續接雨滴');
        finish();
      });
      fx.appendChild(el);
      if (drops < NEED) goal('毛毛蟲來吃葉子了！點牠趕走', true);
    }
    later(bug, rnd(3500, 6000));
  }
  paint();
  later(drop, 300);
  later(bug, 2500);
}
async function water(tree) {
  const me = alive;
  let r;
  try { r = await ctx.api.water(tree); } catch (err) { goal(err.message); return; }
  if (me !== alive) return;
  ctx.refresh(r);
  const t = r.trees?.[tree] ?? { grow: r.grow };
  $('.pw-stage .tree', pop).src = `img/pet/farm/${tree}-${treeStage(r.reap ? 3 : t.grow)}.webp`;
  const left = Math.max(0, 3 - (r.grow ?? 0));
  let msg = r.grow >= 3 ? '結果子了！' : `長大了！再澆 ${left} 天就會結果`;
  if (r.magic) msg = `🦄 小獨角獸施了魔法，多長一階！${msg}`;
  if (r.reap) msg = `🐜 小蟻公主幫你收成了 ${r.reap.n} 顆${FRUIT[tree]}！`;
  got(`<b>${msg}</b>`, 2400);
  $('.pw-bar', pop)?.remove();
  $('.pw-grow', pop).innerHTML = `${'🌱'.repeat(Math.min(3, r.reap ? 0 : r.grow))}${'⚪'.repeat(r.reap ? 3 : left)}<small>${r.reap ? '明天開始再澆水' : msg}</small>`;
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = r.grow >= 3 && !r.reap ? `<button type="button" class="btn" data-reap>收成${FRUIT[tree]}！</button>` : '<button type="button" class="btn" data-pg-ok>好</button>';
  pop.querySelector('.pg').appendChild(row);
  $('[data-pg-ok]', row)?.addEventListener('click', close);
  $('[data-reap]', row)?.addEventListener('click', (e) => reap(tree, e.currentTarget));
  goal(r.grow >= 3 && !r.reap ? `點「收成${FRUIT[tree]}」` : '明天再來澆水');
}
async function reap(tree, b) {
  const me = alive;
  b.disabled = true;
  let r;
  try { r = await ctx.api.harvest(tree); } catch (err) { goal(err.message); b.disabled = false; return; }
  if (me !== alive) return;
  ctx.refresh(r);
  $('.pw-stage .tree', pop).src = `img/pet/farm/${tree}-1.webp`;
  got(`<img src="${img(r.reap.fruit)}" alt=""><b>收成 ${r.reap.n} 顆${FRUIT[tree]}！</b>${r.reap.seeds ? '<small>🐹 黃金鼠還多撿到一份葵花子</small>' : ''}`, 2600);
  b.textContent = '好';
  b.disabled = false;
  b.onclick = close;
  goal('果子拿去烤點心爐，可以烤成點心');
}

// ---------- 烤點心 ----------
// 選食譜（材料夠才能選）→ 放進烤爐 → 進度條跑到「剛剛好」按「拿出來」：剛剛好 2 個，太早太晚 1 個。
// 小火龍：剛剛好的範圍比較大。
export function openBake(c) {
  ctx = c;
  const inv = ctx.state().inventory ?? {};
  const card = (r) => {
    const lack = Object.entries(r.need).filter(([k, n]) => (inv[k] ?? 0) < n);
    const need = Object.entries(r.need).map(([k, n]) => `<span class="${(inv[k] ?? 0) >= n ? 'ok' : 'no'}"><img src="${img(k)}" alt="">${NAME[k]} ${inv[k] ?? 0}/${n}</span>`).join('');
    return `<button type="button" class="pb-r${lack.length ? ' lack' : ''}" data-recipe="${r.code}" ${lack.length ? 'disabled' : ''}>
      <img class="snack" src="${img(r.code)}" alt=""><b>${r.name}</b><small class="bf">吃了${r.buff}</small>
      <span class="need">${need}</span>${lack.length ? `<small class="pb-hint">${lack[0][0].startsWith('fish') ? '去池塘釣魚' : `去澆${TREES[lack[0][0].slice(6)]}`}</small>` : ''}</button>`;
  };
  frame('pg-bake', '烤點心', `<p class="lead">選一個食譜，材料夠的就能烤。烤好的點心給照顧中的夥伴吃，2 小時內會有特別的本事！</p>
    <div class="pb-list">${RECIPES.map(card).join('')}</div>
    <p class="pg-goal" aria-live="polite"></p>`);
  const any = RECIPES.some((r) => Object.entries(r.need).every(([k, n]) => (inv[k] ?? 0) >= n));
  goal(any ? '點一個食譜開始烤' : '材料還不夠：先去收成果子或釣魚');
  pop.querySelectorAll('[data-recipe]').forEach((b) => { b.onclick = () => bakeRun(RECIPES.find((r) => r.code === b.dataset.recipe)); });
}
function bakeRun(rec) {
  const dragon = ctx.has('dragon');
  const g0 = dragon ? .52 : .6, g1 = dragon ? .84 : .76;
  frame('pg-bake', `烤${rec.name}`, `
    <div class="pb-stage"><img class="oven" src="img/pet/furniture/oven.webp" alt=""><img class="snack" src="${img(rec.code)}" alt="">
      <div class="pg-got" hidden></div></div>
    <div class="pb-heat"><i class="good" style="left:${g0 * 100}%;width:${(g1 - g0) * 100}%"></i><i class="fill"></i><span class="tag" style="left:${(g0 + g1) / 2 * 100}%">剛剛好</span></div>
    <p class="pg-goal" aria-live="polite"></p>
    <button type="button" class="btn" data-take>拿出來！</button>
    ${dragon ? '<p class="pg-help">🐉 小火龍幫忙看火：剛剛好的範圍比較大</p>' : ''}`);
  const me = alive, fill = $('.pb-heat .fill', pop), take = $('[data-take]', pop), snack = $('.pb-stage .snack', pop);
  const T = 4200, t0 = performance.now();
  let v = 0, done = false;
  goal('等進度跑到「剛剛好」，按「拿出來！」');
  const step = () => {
    if (me !== alive || done) return;
    v = Math.min(1, (performance.now() - t0) / T);
    fill.style.width = `${v * 100}%`;
    snack.style.filter = `brightness(${1.15 - Math.max(0, v - g1) * 1.6}) saturate(${.6 + v * .6})`;
    if (v >= g0 && v <= g1) goal('剛剛好！快拿出來！', true);
    else if (v > g1) goal('快焦了！拿出來！', true);
    if (v >= 1) { finish(); return; }
    requestAnimationFrame(step);
  };
  async function finish() {
    if (done) return;
    done = true;
    take.disabled = true;
    const good = v >= g0 && v <= g1;
    let r;
    try { r = await ctx.api.bake(rec.code, good); } catch (err) { goal(err.message); return; }
    if (me !== alive) return;
    ctx.refresh(r);
    got(`<img src="${img(rec.code)}" alt=""><b>${good ? `烤得剛剛好！${rec.name} ×2` : v < g0 ? `有點太早…${rec.name} ×1` : `有點焦…${rec.name} ×1`}</b><small>拿去「餵食」給夥伴吃，${rec.buff}</small>`, 60000);
    take.textContent = '再烤一個';
    take.disabled = false;
    take.onclick = () => openBake(ctx);
    goal('點「餵食」把點心給夥伴吃');
  }
  take.onclick = finish;
  requestAnimationFrame(step);
}
