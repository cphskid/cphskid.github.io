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
// 裝飾過的點心（-deco）、加了配料的豪華點心（-gold）跟原本的點心共用一張圖
const baseCode = (code) => String(code ?? '').replace(/-(deco|gold)$/, '');
const img = (code) => `img/pet/food/${baseCode(code)}.webp`;
Object.assign(NAME, { 'cook-honey': '蜂蜜', 'cook-cream': '鮮奶油', 'cook-choco': '巧克力', 'cook-bait': '魚餌', 'cook-fert': '肥料' });
export const TOPPINGS = ['cook-honey', 'cook-cream', 'cook-choco'];
const inv = () => ctx.state().inventory ?? {};
// 魚餌：用一個管接下來 5 條（關掉窗戶也記得，存在這台裝置）
const BAIT_KEY = 'park-pet-bait-left';
const baitLeft = () => { try { return Math.max(0, +localStorage.getItem(BAIT_KEY) || 0); } catch { return 0; } };
const setBait = (n) => { try { localStorage.setItem(BAIT_KEY, String(Math.max(0, n))); } catch { /* 私密視窗 */ } };
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
      <div class="pf-bait"></div>
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
  // 魚餌：接下來 5 條至少從中魚算（綠色區大小還是照真的連續條數）
  const size = () => { const s = baitLeft() > 0 ? Math.max(streak, 2) : streak; return s >= 4 ? 3 : s >= 2 ? 2 : 1; };
  const paintBait = () => {
    const box = $('.pf-bait', pop), n = baitLeft(), have = inv()['cook-bait'] ?? 0;
    if (n > 0) box.innerHTML = `<p class="pf-chip"><img src="${img('cook-bait')}" alt="">魚餌還管 ${n} 條：從中魚開始</p>`;
    else if (have > 0) box.innerHTML = `<button type="button" class="pf-chip" data-bait><img src="${img('cook-bait')}" alt="">用魚餌（還有 ${have} 個）：接下來 5 條從中魚開始</button>`;
    else box.innerHTML = '';
    $('[data-bait]', box)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await ctx.api.bait(); ctx.refresh(r); setBait(baitLeft() + (r.bait ?? 5)); } catch (err) { goal(err.message); }
      if (me === alive) { paintBait(); paintStreak(); }
    });
  };
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
    if (baitLeft() > 0) setBait(baitLeft() - 1);
    paintStreak();
    paintBait();
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
  paintBait();
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
  const fert = inv()['cook-fert'] ?? 0;
  frame('pg-water', TREES[tree], `${head}<div class="pw-bar"><i></i></div>
    ${fert ? `<label class="pf-chip pw-fert"><input type="checkbox" data-fert><img src="${img('cook-fert')}" alt="">澆水時加一份肥料，多長一天（還有 ${fert} 包）</label>` : ''}`);
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
  const fert = !!$('[data-fert]', pop)?.checked;
  try { r = await ctx.api.water(tree, fert); } catch (err) { goal(err.message); return; }
  $('.pw-fert', pop)?.remove();
  if (me !== alive) return;
  ctx.refresh(r);
  const t = r.trees?.[tree] ?? { grow: r.grow };
  $('.pw-stage .tree', pop).src = `img/pet/farm/${tree}-${treeStage(r.reap ? 3 : t.grow)}.webp`;
  const left = Math.max(0, 3 - (r.grow ?? 0));
  let msg = r.grow >= 3 ? '結果子了！' : `長大了！再澆 ${left} 天就會結果`;
  if (r.fert) msg = `🌱 肥料讓它多長一天！${msg}`;
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
// 選食譜（材料夠才能選）→ 顧火候：按住「加柴」溫度上升、放開慢慢降，溫度停在綠色區累積 3 秒就烤熟。
// 太燙（紅色區）待太久＝有點焦，只出 1 個；顧得好出 2 個（不會烤失敗）。
// 烤好後可以「直接拿」，或「幫它裝飾」：照夥伴想要的樣子把 3 個裝飾擺上去，效果 2 → 3 小時；
// 裝飾時加一份食材攤的配料（蜂蜜、鮮奶油、巧克力）變豪華點心，效果 4 小時。
// 小火龍：綠色區比較大、風吹得溫度比較不會亂跳。
export function openBake(c) {
  ctx = c;
  const have = inv();
  const card = (r) => {
    const lack = Object.entries(r.need).filter(([k, n]) => (have[k] ?? 0) < n);
    const need = Object.entries(r.need).map(([k, n]) => `<span class="${(have[k] ?? 0) >= n ? 'ok' : 'no'}"><img src="${img(k)}" alt="">${NAME[k]} ${have[k] ?? 0}/${n}</span>`).join('');
    return `<button type="button" class="pb-r${lack.length ? ' lack' : ''}" data-recipe="${r.code}" ${lack.length ? 'disabled' : ''}>
      <img class="snack" src="${img(r.code)}" alt=""><b>${r.name}</b><small class="bf">吃了${r.buff}</small>
      <span class="need">${need}</span>${lack.length ? `<small class="pb-hint">${lack[0][0].startsWith('fish') ? '去池塘釣魚' : `去澆${TREES[lack[0][0].slice(6)]}`}</small>` : ''}</button>`;
  };
  frame('pg-bake', '烤點心', `<p class="lead">選一個食譜，材料夠的就能烤。烤好的點心給照顧中的夥伴吃，會有特別的本事！</p>
    <div class="pb-list">${RECIPES.map(card).join('')}</div>
    <p class="pg-goal" aria-live="polite"></p>`);
  const any = RECIPES.some((r) => Object.entries(r.need).every(([k, n]) => (have[k] ?? 0) >= n));
  goal(any ? '點一個食譜開始烤' : '材料還不夠：先去收成果子或釣魚');
  pop.querySelectorAll('[data-recipe]').forEach((b) => { b.onclick = () => bakeRun(RECIPES.find((r) => r.code === b.dataset.recipe)); });
}

function bakeRun(rec) {
  const dragon = ctx.has('dragon');
  const g0 = dragon ? .5 : .58, g1 = dragon ? .8 : .74, HOT = .9;
  const NEED = 3, LIMIT = 20;            // 綠色區要累積 3 秒；20 秒還沒烤熟就先拿出來
  frame('pg-bake', `烤${rec.name}`, `
    <div class="pb-stage"><img class="oven" src="img/pet/furniture/oven.webp" alt="">
      <img class="flame" src="img/pet/game/flame.webp" alt=""><img class="snack" src="${img(rec.code)}" alt="">
      ${dragon ? '<p class="pf-buff">🐉 小火龍加成：綠色區放大、溫度比較穩</p>' : ''}
      <div class="pg-got" hidden></div></div>
    <div class="pb-temp" aria-hidden="true"><i class="good" style="left:${g0 * 100}%;width:${(g1 - g0) * 100}%"></i><i class="hot" style="left:${HOT * 100}%"></i><i class="nail"></i></div>
    <div class="pb-done"><span>烤熟</span><div class="pw-bar"><i></i></div></div>
    <p class="pg-goal" aria-live="polite"></p>
    <button type="button" class="btn pb-fire" data-fire><img src="img/pet/game/log.webp" alt="">按住加柴</button>`);
  const me = alive, nail = $('.pb-temp .nail', pop), bar = $('.pb-done i', pop), fire = $('[data-fire]', pop);
  const flame = $('.pb-stage .flame', pop), snack = $('.pb-stage .snack', pop);
  let T = .2, prog = 0, burnt = 0, hold = false, last = performance.now(), t0 = last, done = false, gust = 0, nextGust = 1.5;
  const say = (s, hot) => { if ($('.pg-goal', pop).textContent !== s) goal(s, hot); };
  say('按住「加柴」，讓溫度升到綠色');
  const step = (now) => {
    if (me !== alive || done) return;
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    const el = (now - t0) / 1000;
    // 風：每 1.2～2.4 秒吹一下，溫度往上或往下飄（小火龍飄一半）
    if (el > nextGust) { gust = (Math.random() < .5 ? -1 : 1) * rnd(.05, .12) * (dragon ? .5 : 1); nextGust = el + rnd(1.2, 2.4); }
    T += (hold ? .36 : -.24) * dt + gust * dt * 3;
    gust *= .9;
    T = Math.max(0, Math.min(1, T));
    const inZone = T >= g0 && T <= g1;
    if (inZone) prog += dt / NEED;
    if (T > HOT) burnt += dt;
    nail.style.left = `${T * 100}%`;
    bar.style.width = `${Math.min(100, prog * 100)}%`;
    flame.style.transform = `translate(-50%, 0) scale(${.35 + T * .9})`;
    flame.style.opacity = String(.35 + T * .65);
    snack.style.filter = `saturate(${.5 + prog * .6}) brightness(${1.1 - Math.max(0, burnt - .3) * .15})`;
    if (T > HOT) say('太燙了！放開讓它降溫', true);
    else if (inZone) say('溫度剛剛好，保持住！', true);
    else if (T > g1) say('有點燙，放開一下');
    else if (T < .25 && el > 2) say('火快熄了，按住加柴', true);
    else say('按住「加柴」，讓溫度升到綠色');
    if (prog >= 1 || el >= LIMIT) { finish(); return; }
    requestAnimationFrame(step);
  };
  const on = (e) => { e?.preventDefault(); hold = true; fire.classList.add('on'); };
  const off = (e) => { e?.preventDefault(); hold = false; fire.classList.remove('on'); };
  fire.addEventListener('pointerdown', on);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((k) => fire.addEventListener(k, off));
  fire.addEventListener('contextmenu', (e) => e.preventDefault());
  fire.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) on(e); });
  fire.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') off(e); });
  function finish() {
    done = true;
    const good = prog >= 1 && burnt < 1;
    const n = good ? 2 : 1;
    const why = good ? '顧得剛剛好！' : prog < 1 ? '火候不太夠…' : '有點焦…';
    $('.pb-temp', pop).remove();
    $('.pb-done', pop).remove();
    fire.remove();
    flame.remove();
    const row = document.createElement('div');
    row.className = 'pb-pick';
    row.innerHTML = `<p class="pb-res"><b>${why}烤好 ${rec.name} ×${n}</b></p>
      <button type="button" class="btn" data-deco>✨ 幫它裝飾<small>效果變 3 小時，加配料 4 小時</small></button>
      <button type="button" class="ghost" data-plain>直接拿（效果 2 小時）</button>`;
    pop.querySelector('.pg').appendChild(row);
    goal('要幫點心裝飾嗎？');
    $('[data-plain]', row).onclick = () => bakeSave(rec, good, false, null);
    $('[data-deco]', row).onclick = () => decorate(rec, good);
  }
  requestAnimationFrame((t) => { last = t0 = t; requestAnimationFrame(step); });
}

// 裝飾：夥伴想要的樣子先給你看 3 秒（可以再看），點下面的裝飾、再點點心上的圈圈放上去
const DECO = { star: '星星糖', heart: '愛心糖', mint: '薄荷葉', cherry: '櫻桃', berry: '藍莓' };
const SPOTS = [[24, 34], [50, 18], [76, 34]];
function decorate(rec, good) {
  const pet = ctx.pet?.() ?? null;
  const who = pet?.name ?? '夥伴';
  const keys = Object.keys(DECO);
  const want = SPOTS.map(() => keys[Math.floor(Math.random() * keys.length)]);
  const tops = TOPPINGS.filter((k) => (inv()[k] ?? 0) > 0);
  const spotHtml = (arr, cls) => SPOTS.map(([x, y], k) => `<button type="button" class="pd-spot ${cls}" data-spot="${k}" style="left:${x}%;top:${y}%" aria-label="第 ${k + 1} 個位置">${arr[k] ? `<img src="img/pet/game/deco-${arr[k]}.webp" alt="${DECO[arr[k]]}">` : ''}</button>`).join('');
  frame('pg-bake pg-deco', `裝飾${rec.name}`, `
    <div class="pd-wrap">
      <div class="pd-order"><b>${esc(who)}想要這樣：</b><div class="pd-cake mini"><img class="snack" src="${img(rec.code)}" alt="">${spotHtml(want, 'show')}</div>
        <button type="button" class="ghost small" data-peek>再看一次</button></div>
      <div class="pd-cake big"><img class="snack" src="${img(rec.code)}" alt=""><img class="pd-top" alt="" hidden>${spotHtml([], 'put')}<div class="pg-got" hidden></div></div>
    </div>
    <div class="pd-tray">${keys.map((k) => `<button type="button" class="pd-piece" data-piece="${k}" aria-label="${DECO[k]}"><img src="img/pet/game/deco-${k}.webp" alt=""><small>${DECO[k]}</small></button>`).join('')}</div>
    <div class="pd-tops">${tops.length ? `<span>加配料（效果 4 小時）：</span>${tops.map((k) => `<button type="button" class="pf-chip" data-top="${k}"><img src="${img(k)}" alt="">${NAME[k]} ×${inv()[k]}</button>`).join('')}`
      : '<span>商店的「食材攤」有賣配料，裝飾時加一份效果變 4 小時</span>'}</div>
    <p class="pg-goal" aria-live="polite"></p>
    <div class="row"><button type="button" class="btn" data-done disabled>完成裝飾</button></div>`);
  const me = alive, order = $('.pd-order', pop);
  const put = [null, null, null];
  let pick = null, top = null, miss = 0;
  const peek = (ms) => { order.classList.add('open'); later(() => order.classList.remove('open'), ms); };
  peek(3200);
  goal(`記住${who}想要的樣子，再把裝飾擺上去`);
  $('[data-peek]', pop).onclick = () => peek(2200);
  pop.querySelectorAll('[data-piece]').forEach((b) => {
    b.onclick = () => {
      pick = b.dataset.piece;
      pop.querySelectorAll('[data-piece]').forEach((x) => x.classList.toggle('on', x === b));
      goal(`點點心上的圈圈，把${DECO[pick]}放上去`);
    };
  });
  pop.querySelectorAll('.pd-spot.put').forEach((s) => {
    s.onclick = () => {
      const k = +s.dataset.spot;
      if (!pick) { goal('先點下面的一個裝飾', true); return; }
      put[k] = pick;
      s.innerHTML = `<img src="img/pet/game/deco-${pick}.webp" alt="${DECO[pick]}">`;
      s.classList.remove('bad');
      if (put.every(Boolean)) check();
      else goal('再放下一個');
    };
  });
  pop.querySelectorAll('[data-top]').forEach((b) => {
    b.onclick = () => {
      top = top === b.dataset.top ? null : b.dataset.top;
      pop.querySelectorAll('[data-top]').forEach((x) => x.classList.toggle('on', x.dataset.top === top));
      const im = $('.pd-top', pop);
      im.hidden = !top;
      if (top) im.src = img(top);
    };
  });
  function check() {
    const wrong = put.map((v, k) => v !== want[k]);
    if (wrong.some(Boolean)) {
      miss++;
      wrong.forEach((w, k) => {
        if (!w) return;
        const s = pop.querySelector(`.pd-spot.put[data-spot="${k}"]`);
        s.classList.add('bad');
        later(() => { if (me === alive) { s.classList.remove('bad'); s.innerHTML = ''; } }, 700);
        put[k] = null;
      });
      const n = wrong.filter(Boolean).length;
      goal(`有 ${n} 個跟${who}想的不一樣，再試試`, true);
      if (miss >= 2) peek(2200);   // 錯兩次自動再給看一次
      return;
    }
    goal(top ? `完美！還加了${NAME[top]}，按「完成裝飾」` : '完美！按「完成裝飾」', true);
    $('[data-done]', pop).disabled = false;
  }
  $('[data-done]', pop).onclick = (e) => { e.currentTarget.disabled = true; bakeSave(rec, good, true, top); };
}

async function bakeSave(rec, good, deco, top) {
  const me = alive;
  pop.querySelectorAll('.pb-pick button, [data-done]').forEach((b) => { b.disabled = true; });
  let r;
  try { r = await ctx.api.bake(rec.code, good, deco, top); } catch (err) { goal(err.message); pop.querySelectorAll('.pb-pick button').forEach((b) => { b.disabled = false; }); return; }
  if (me !== alive) return;
  ctx.refresh(r);
  const hours = top ? 4 : deco ? 3 : 2;
  const label = top ? `豪華${rec.name}` : deco ? `裝飾${rec.name}` : rec.name;
  got(`<img src="${img(rec.code)}" alt=""><b>${label} ×${r.n ?? (good ? 2 : 1)}</b><small>拿去「餵食」給夥伴吃，${hours} 小時內${rec.buff}</small>`, 60000);
  $('.pb-pick', pop)?.remove();
  $('.pd-tray', pop)?.remove();
  $('.pd-tops', pop)?.remove();
  const row = $('.row', pop) ?? pop.querySelector('.pg').appendChild(Object.assign(document.createElement('div'), { className: 'row' }));
  row.innerHTML = '<button type="button" class="btn" data-again>再烤一個</button>';
  $('[data-again]', row).onclick = () => openBake(ctx);
  goal('點「餵食」把點心給夥伴吃');
}
