// 聖誕活動「雪花聖誕村」（2026-11-19 串「提案島嶼風格與聖誕活動」，Chuck 選雪花 A 方案）
// 資料庫在 supabase/park_snow.sql：雪花結晶帳本（每天：滑雪 12＋學習設施 20＋每日任務 5＋寵物小遊戲 3；2026-11-27 學習設施 10→20、月曆有玩關卡那天雪花加倍）、降臨月曆、滑雪紀錄、全站大聖誕樹。
// 這裡管：活動狀態、寵物島右邊的兩顆按鈕（降臨月曆、雪山滑雪橇）、降臨月曆視窗、「今天的雪花」說明。
// 活動還沒開始、資料庫還沒裝好時什麼都不出現。
import * as auth from './auth.js';
import * as playlog from './playlog.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let st = null;
export const state = () => st;
export const on = () => !!st?.on;
export async function load() {
  try { st = await auth.snow.me(); } catch { st = null; }
  return st;
}
export function set(s) { if (s) st = { ...st, ...s }; dispatchEvent(new CustomEvent('park:snow', { detail: st })); }

export const SNOW = '<img class="snow-ic" src="img/xmas/snow.webp" alt="雪花">';

// 降臨月曆每一格的禮物（跟 park_snow_gift 一樣）
const GIFTS = [
  ['snow', 5], ['pet', 'biscuit', 2], ['snow', 5], ['pet', 'candy', 2], ['snow', 6], ['pet', 'cook-honey', 2], ['snow', 6], ['furn', 'xm-lamp'],
  ['snow', 7], ['pet', 'fish', 2], ['snow', 7], ['pet', 'cook-cream', 2], ['snow', 8], ['pet', 'apple', 2], ['snow', 8], ['furn', 'xm-gifts'],
  ['snow', 8], ['pet', 'cook-choco', 2], ['snow', 9], ['pet', 'seeds', 3], ['snow', 9], ['pet', 'cook-bait', 3], ['snow', 10], ['snow', 10],
  ['furn', 'xm-sled'],
];
const NAME = { biscuit: '骨頭餅乾', candy: '彩色糖果', 'cook-honey': '蜂蜜', fish: '小魚乾', 'cook-cream': '鮮奶油', apple: '蘋果片',
               'cook-choco': '巧克力', seeds: '葵花子', 'cook-bait': '魚餌', 'xm-lamp': '拐杖糖路燈', 'xm-gifts': '禮物堆', 'xm-sled': '麋鹿雪橇' };
function giftOf(day, bonus = false) {
  const g = GIFTS[day - 1];
  if (g[0] === 'snow') return { img: 'img/xmas/snow.webp', text: bonus ? `雪花 ×${g[1] * 2}（加倍）` : `雪花 ×${g[1]}` };
  if (g[0] === 'pet') return { img: `img/pet/food/${g[1]}.webp`, text: `${NAME[g[1]]} ×${g[2]}` };
  return { img: `img/pet/furniture/${g[1]}.webp`, text: NAME[g[1]] };
}

// 寵物島右邊的按鈕
export function petButtons() {
  if (!on()) return '';
  return `<div class="snow-dock">
    <button type="button" data-snow-advent aria-label="降臨月曆"><img src="img/xmas/advent.webp" alt=""><b>月曆</b>${canOpenToday() ? '<i class="dot"></i>' : ''}</button>
    <button type="button" data-snow-ski aria-label="雪山滑雪橇"><img src="img/xmas/sled.webp" alt=""><b>滑雪</b></button>
    <span class="snow-bal">${SNOW}<b>${st.balance}</b></span>
  </div>`;
}
const opened = () => new Set((st?.advent?.opened ?? []).map((x) => x.day));
const canOpenToday = () => st?.advent?.today > 0 && !opened().has(st.advent.today);

// 今天的雪花：從哪裡拿、拿了幾片（照「進到環境不要不知所措」，每個窗都看得到怎麼賺）
export function todayHtml() {
  if (!st) return '';
  const rows = [['ski', '雪山滑雪橇', '撿雪花、把禮物丟進煙囪'], ['learn', '去島上冒險', '開拓者、守護、祕境島、實驗室、試煉島：每玩一關 3 片，過關 6 片'],
                ['daily', '每日任務', '全部做完'], ['pet', '寵物島小遊戲', '釣魚、澆果樹、烤點心']];
  return `<div class="snow-today"><p class="lab">今天的雪花 ${SNOW}</p>${rows.map(([k, n, how]) => {
    const got = st.today?.[k] ?? 0, cap = st.caps?.[k] ?? 0;
    return `<div class="srow${got >= cap ? ' done' : ''}"><b>${n}</b><small>${how}</small><span>${got}/${cap}</span></div>`;
  }).join('')}<small class="tip">每天最多 40 片；降臨月曆的雪花另外算（12/1 起，那天有去島上冒險，月曆的雪花加倍）。12/31 活動結束時，剩下的雪花每 10 片換 50 時光幣。</small></div>`;
}

// ---------- 降臨月曆 ----------
let veil = null;
function close() { leave?.(); leave = null; veil?.remove(); veil = null; }
let leave = null;
export function openAdvent({ onGift } = {}) {
  close();
  leave = playlog.visit('advent', '降臨月曆');   // 遊玩紀錄（管理員統計的「聖誕活動」）
  veil = document.createElement('div');
  veil.className = 'snow-veil';
  document.body.appendChild(veil);
  paint();
  function paint(msg = null) {
    const a = st.advent ?? { today: 0, opened: [], makeups: 0 };
    const op = new Map(a.opened.map((x) => [x.day, x]));
    // 提案圖的木頭小屋：每扇門是一塊木門板（鈴鐺、雪花、星星、手套、拐杖糖輪流），打開是暗暗的小格子放禮物、門板翻到左邊
    const LOOK = ['bell', 'flake', 'star', 'mitten', 'cane'];
    const face = (d) => `style="--door:url(../img/xmas/advent/d-${LOOK[(d * 3) % 5]}.webp)"`;
    const doors = Array.from({ length: 25 }, (_, i) => {
      const d = i + 1;
      if (op.has(d)) { const g = giftOf(d, op.get(d).bonus); return `<div class="door open" title="${esc(g.text)}"><i class="leaf"></i><img src="${g.img}" alt=""><small>${esc(g.text)}</small></div>`; }
      if (d === a.today) return `<button type="button" class="door today" data-day="${d}" ${face(d)}><b>${d}</b><small>今天！</small></button>`;
      if (d < a.today) return `<button type="button" class="door miss" data-day="${d}" ${face(d)}${a.makeups > 0 ? '' : ' disabled'}><b>${d}</b><small>${a.makeups > 0 ? '補開' : '沒開到'}</small></button>`;
      return `<div class="door later" ${face(d)}><b>${d}</b></div>`;
    }).join('');
    veil.innerHTML = `<div class="snow-box advent" role="dialog" aria-modal="true" aria-label="降臨月曆">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="head"><img src="img/xmas/advent.webp" alt=""><div><h2>降臨月曆</h2>
        <p>12/1～12/25 每天開一格小禮物；第 25 格是麋鹿雪橇。沒開到的那天，完成當天的每日任務就能補開一格（現在可以補開 <b>${a.makeups}</b> 格）。<br>當天有去島上冒險玩關卡，那天開到的雪花加倍！${a.learn_today ? '（今天已經玩過，加倍 ✓）' : ''}</p></div>
        <span class="snow-bal">${SNOW}<b>${st.balance}</b></span></div>
      ${a.today === 0 ? '<p class="note">月曆 12/1 才開始，先去滑雪收集雪花吧！</p>' : ''}
      ${msg ? `<p class="note ${msg[0]}">${esc(msg[1])}</p>` : ''}
      <div class="adv-house"><img class="roof" src="img/xmas/advent/roof.webp" alt=""><div class="wall"><div class="doors">${doors}</div></div><img class="bear" src="img/xmas/advent/bear.webp" alt=""></div>
      ${todayHtml()}
    </div>`;
    $('[data-close]', veil).onclick = close;
    veil.onclick = (e) => { if (e.target === veil) close(); };
    veil.querySelectorAll('[data-day]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await auth.snow.advent(+b.dataset.day);
          set(r);
          sfx('SE-20');
          const g = giftOf(+b.dataset.day, !!r.gift?.bonus);
          const more = GIFTS[+b.dataset.day - 1][0] === 'snow' && !r.gift?.bonus ? '今天去島上冒險玩一關，這格的雪花還會再送一次！' : '';
          paint(['ok', `打開第 ${b.dataset.day} 格：${g.text}！${more}${GIFTS[+b.dataset.day - 1][0] === 'furn' ? '已經放進寵物島的傢俱裡了。' : GIFTS[+b.dataset.day - 1][0] === 'pet' ? '放進寵物的背包了。' : ''}`]);
          veil.querySelectorAll('.door')[+b.dataset.day - 1]?.classList.add('pop');
          onGift?.(r.gift);
        } catch (err) { paint(['bad', err.message]); }
      };
    });
  }
}

// ---------- 全站大聖誕樹（大廳村莊廣場、鐘塔前） ----------
// 大家「賺到」的雪花都會點亮它（換東西不會扣）。亮到每一層，活動期間賺過雪花的人都拿到那層的禮物。
export const TIERS = [
  ['雪花頭像框', 'img/xmas/snow.webp'],
  ['寵物聖誕帽', 'img/xmas/hat.webp'],
  ['聖誕樹傢俱', 'img/pet/furniture/xm-tree.webp'],
  ['島名聖誕字', 'img/xmas/advent.webp'],
  ['點燈小幫手框＋全站煙火', 'img/xmas/tree.webp'],
];
const tree = () => st?.tree ?? null;
const fmt = (n) => Number(n ?? 0).toLocaleString('zh-TW');
export function treeLevel() {
  const t = tree();
  if (!t?.tiers) return { lv: 0, pct: 0 };
  const lv = t.tiers.filter((x) => t.total >= x).length;
  // 一層一層亮：每層占樹的 1/5，層裡面照進度慢慢往上
  const lo = t.tiers[lv - 1] ?? 0, hi = t.tiers[lv];
  const part = hi ? (t.total - lo) / (hi - lo) : 0;
  return { lv, pct: Math.min(1, (lv + part) / t.tiers.length) };
}
export const hasHat = () => !!tree()?.got?.includes(2) && hatOn();
function hatOn() { try { return localStorage.getItem('park:snow-hat') !== '0'; } catch { return true; } }
function setHat(v) { try { localStorage.setItem('park:snow-hat', v ? '1' : '0'); } catch { /* 存不到就算了 */ } }

// 地圖上村莊島的那棵樹（亮的部分從下往上長）
function treeArt(cls = '') {
  const { lv, pct } = treeLevel();
  return `<span class="xtree ${cls}${lv >= 5 ? ' lit-all' : ''}" style="--lit:${(pct * 100).toFixed(1)}%">
    <img class="xt-dim" src="img/xmas/tree-big.webp" alt=""><img class="xt-lit" src="img/xmas/tree-big.webp" alt="">${lv >= 5 ? '<i class="fw a"></i><i class="fw b"></i><i class="fw c"></i>' : ''}</span>`;
}
// 活動期間村莊換成下雪的樣子（img/l-01-xmas.webp）。大樹原本疊在村莊鐘塔右邊；2026-11-27 起改成獨立一座大樹小島（paintTreeIsle），
// 地圖有 map.xtree_isle 的時候村莊上就不再疊樹，免得同時兩棵。
export function paintMapTree(lift, hasIsle = false) {
  document.querySelectorAll('.xtree.map').forEach((el) => el.remove());
  const art = lift?.querySelector('img.art');
  const show = !!(lift && tree()?.tiers && (st.on || st.ended));
  if (art) {
    art.dataset.orig ??= art.getAttribute('src');
    const want = show ? 'img/l-01-xmas.webp' : art.dataset.orig;
    if (art.getAttribute('src') !== want) art.setAttribute('src', want);
  }
  if (show && !hasIsle) lift.insertAdjacentHTML('beforeend', treeArt('map'));
}

// ---------- 大樹小島＋木牌下的點燈進度條（2026-11-27 Chuck：樹太小、看不出慢慢點燈，目標不明顯） ----------
// 圖 img/xmas/tree-isle.webp（600×753，樹本身沒有燈），燈泡是程式畫的：5 圈燈串由下往上，一圈＝一層，
// 這一層照進度亮幾顆，亮滿一層就換下一圈；5 層都亮了星星發光＋煙火。
// [y, 左 x, 右 x, 顆數]（圖上的像素，第 1 層在最下面）
const GARLAND = [[440, 185, 430, 9], [368, 192, 415, 8], [305, 205, 400, 7], [242, 222, 380, 6], [180, 240, 355, 5]];
const BULB_C = ['#ffd84a', '#ff6b6b', '#6be4ff', '#9dff6b', '#ff9ef5'];
const TIER_SHORT = ['雪花頭像框', '寵物聖誕帽', '聖誕樹傢俱', '島名聖誕字', '全站煙火'];
// 每一層亮了幾顆（這一層至少亮 1 顆才看得出「正在點」）
function bulbState() {
  const t = tree();
  if (!t?.tiers) return { lv: 0, part: 0, lit: GARLAND.map(() => 0) };
  const lv = t.tiers.filter((x) => t.total >= x).length;
  const lo = t.tiers[lv - 1] ?? 0, hi = t.tiers[lv];
  const part = hi ? Math.max(0, Math.min(1, (t.total - lo) / (hi - lo))) : 1;
  const lit = GARLAND.map(([, , , n], i) => (i < lv ? n : i === lv ? Math.max(t.total > lo ? 1 : 0, Math.floor(part * n)) : 0));
  return { lv, part, lit };
}
function bulbsHtml() {
  const { lv, lit } = bulbState();
  let h = '';
  GARLAND.forEach(([y, a, b, n], t) => {
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const x = a + (b - a) * k, yy = y + 14 * Math.sin(Math.PI * k) - 8 * k;   // 燈串在樹前面往下垂
      h += `<i class="xb${i < lit[t] ? ' on' : ''}" style="left:${(x / 6).toFixed(2)}%;top:${(yy / 7.53).toFixed(2)}%;--c:${BULB_C[(i + t) % 5]};--d:${((i * 0.37 + t * 0.21) % 2).toFixed(2)}s"></i>`;
    }
    h += `<b class="xn${t < lv ? ' done' : t === lv ? ' now' : ''}" style="left:${((b + 30) / 6).toFixed(2)}%;top:${((y - 4) / 7.53).toFixed(2)}%">${t + 1}</b>`;
  });
  return h;
}
let isle = null;
// cfg＝data/park.json 的 map.xtree_isle {left, top, width}（地圖座標，放 #isles 圖層，跟著鏡頭縮放）；沒有就不畫
export function paintTreeIsle(layer, cfg, { canClick = () => true } = {}) {
  const show = !!(layer && cfg && tree()?.tiers && (st.on || st.ended));
  if (!show) { isle?.remove(); isle = null; return; }
  if (!isle || !isle.isConnected) {
    isle = document.createElement('button');
    isle.type = 'button';
    isle.className = 'isle xtree-isle';
    isle.style.cssText = `left:${cfg.left}px;top:${cfg.top}px;width:${cfg.width}px;--delay:-4s`;
    isle.addEventListener('click', () => { if (canClick()) { sfx('SE-03'); openTree(); } });
    layer.appendChild(isle);
  }
  const { lv } = bulbState();
  isle.classList.toggle('lit-all', lv >= 5);   // 不能叫 full：css 已經有全域 .full（滿額標籤）
  isle.setAttribute('aria-label', `全站大聖誕樹：${lv >= 5 ? '整棵都亮了' : `第 ${lv + 1} 層點燈中`}，點了看怎麼一起點燈`);
  isle.innerHTML = `<div class="bob"><div class="lift"><img class="tart" src="img/xmas/tree-isle.webp" alt="">
    <i class="xstar"></i>${bulbsHtml()}${lv >= 5 ? '<i class="fw a"></i><i class="fw b"></i><i class="fw c"></i>' : ''}</div></div>
    <div class="plate"><b>全站大聖誕樹</b><span>${lv >= 5 ? '整棵都亮了！' : `第 ${lv + 1} 層點燈中`}</span></div>`;
}
// 進度條放在「冒險地圖」木牌底下（跟著木牌大小變），點了打開玩法說明
export function paintTreeBar(sign, { onLook } = {}) {
  const t = tree();
  const show = !!(sign && t?.tiers && (st.on || st.ended));
  let bar = document.getElementById('xtree-bar');
  if (!show) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('button');
    bar.type = 'button';
    bar.id = 'xtree-bar';
    bar.addEventListener('click', () => { sfx('SE-03'); openTree({ onLook }); });
    sign.appendChild(bar);
  }
  barLook = onLook;
  const { lv, part } = bulbState();
  const segs = t.tiers.map((_, i) => `<i class="${i < lv ? 'done' : i === lv ? 'now' : ''}"${i === lv ? ` style="--p:${(part * 100).toFixed(1)}%"` : ''}></i>`).join('');
  const txt = lv >= 5 ? '大聖誕樹整棵都亮了！' : `第 ${lv + 1} 層：再 <em>${fmt(t.tiers[lv] - t.total)}</em> 盞 → ${TIER_SHORT[lv]}`;
  const short = lv >= 5 ? '全亮了！' : `再 ${fmt(t.tiers[lv] - t.total)} 盞`;
  bar.setAttribute('aria-label', `全站大聖誕樹進度：${lv >= 5 ? '整棵都亮了' : `第 ${lv + 1} 層，再 ${fmt(t.tiers[lv] - t.total)} 盞亮到下一層`}。點了看怎麼玩`);
  bar.innerHTML = `<img src="img/xmas/tree.webp" alt=""><span class="tx"><span class="segs">${segs}</span><span class="long">${txt}</span><span class="short">${short}</span></span><span class="q">?</span>`;
}
let barLook = null;
// 玩法說明：怎麼點燈、5 層禮物、你點了幾盞；「去看大樹」把地圖移過去
// 聖誕卡（js/xcard.js）：暱稱、旅人樣子、怎麼去寵物島由 park.js 告訴這裡（snow.js 不直接讀帳號）
let cardCtx = () => null;
export function setCardCtx(fn) { cardCtx = fn; }
export const canCard = () => !!cardCtx() && !!(st?.on || st?.ended);
export async function openCard(extra = {}) {
  const base = cardCtx();
  if (!base) return;
  const { openCard: open } = await import('./xcard.js');
  open({ ...base, cardDone: !!st?.card || !st?.on, ...extra,
    onSent: async () => { if (st?.card || !st?.on) return 0; const r = await auth.snow.card(); set(r); return r?.got ?? 0; } });
}
let tveil = null;
export function openTree({ onLook } = {}) {
  const t = tree();
  if (!t?.tiers) return;
  tveil?.remove();
  const look = onLook ?? barLook;
  const { lv } = bulbState();
  const got = new Set(t.got ?? []);
  tveil = document.createElement('div');
  tveil.className = 'snow-veil';
  tveil.innerHTML = `<div class="snow-box xtree-help" role="dialog" aria-modal="true" aria-label="一起點亮大聖誕樹">
    <button class="x" data-close aria-label="關閉"></button>
    <div class="head"><img src="img/xmas/tree.webp" alt=""><div><h2>一起點亮大聖誕樹</h2>
      <p>全樂園的小朋友一起點燈！你每賺到 <b>1 片雪花</b>，樹上就多亮 <b>1 盞燈</b>。拿雪花去換東西，燈也不會熄。</p></div></div>
    <p class="lab">怎麼賺雪花</p>
    <div class="xhow"><div><img src="img/l-03-xmas.webp" alt=""><b>去島上冒險</b><small>玩一關 3 片，過關 6 片</small></div>
      <div><img src="img/xmas/sled.webp" alt=""><b>雪橇峰滑雪橇</b><small>撿雪花、送禮物</small></div>
      <div><img src="img/ui/task.webp" alt=""><b>每日任務</b><small>全部做完</small></div>
      <div><img src="img/l-07-xmas.webp" alt=""><b>寵物島小遊戲</b><small>釣魚、澆果樹、烤點心</small></div></div>
    <p class="lab">每亮滿一層，賺過 1 片雪花的人都拿到那層的禮物</p>
    <ol class="xlv">${TIERS.map(([n, img], i) => `<li class="${i < lv ? 'done' : i === lv ? 'now' : ''}"><img src="${img}" alt=""><b>第 ${i + 1} 層</b><span>${n}</span><em>${got.has(i + 1) ? '✓ 已拿到' : i < lv ? '✓ 已亮' : i === lv ? `${fmt(t.total)} / ${fmt(t.tiers[i])}` : `${fmt(t.tiers[i])} 盞`}</em></li>`).join('')}</ol>
    <p class="mine">你一共點了 <b>${fmt(t.mine)}</b> 盞，今天 <b>${fmt(t.mine_today)}</b> 盞。${t.mine > 0 ? '' : '賺到 1 片雪花就算參加！'}</p>
    ${got.has(2) ? `<label class="xhat"><input type="checkbox" data-snow-hat${hatOn() ? ' checked' : ''}> 寵物島的夥伴戴聖誕帽</label>` : ''}
    <div class="row end">${canCard() ? '<button type="button" class="ghost" data-card>寄聖誕卡給朋友</button>' : ''}${look ? '<button type="button" class="btn go" data-look>去看大樹</button>' : '<button type="button" class="btn go" data-close>知道了</button>'}</div>
  </div>`;
  document.body.appendChild(tveil);
  const shut = () => { tveil?.remove(); tveil = null; };
  tveil.addEventListener('click', (e) => { if (e.target === tveil || e.target.closest('[data-close]')) shut(); });
  tveil.querySelector('[data-look]')?.addEventListener('click', () => { shut(); look?.(); });
  tveil.querySelector('[data-card]')?.addEventListener('click', () => { shut(); openCard(); });
  bindTree(tveil);
}

// 村莊卡片裡的大樹說明卡
export function treeHtml() {
  const t = tree();
  if (!t?.tiers || !(st.on || st.ended)) return '';
  const { lv } = treeLevel();
  const next = t.tiers[lv];
  const got = new Set(t.got ?? []);
  return `<div class="fac xtree-card"><h3>全站大聖誕樹</h3>
    <div class="row">${treeArt('big')}
      <div><p>大家賺到的每一片雪花都會點亮這棵樹（拿去換東西也不會扣）。已經點亮 <b>${fmt(t.total)}</b> 盞燈${next ? `，再 <b>${fmt(next - t.total)}</b> 盞亮到第 ${lv + 1} 層` : '，整棵樹都亮了！'}。</p>
      <p>你一共點了 <b>${fmt(t.mine)}</b> 盞，今天 <b>${fmt(t.mine_today)}</b> 盞。${t.mine > 0 ? '' : '賺到 1 片雪花就算參加，亮到的每一層禮物都有你一份！'}</p></div></div>
    <ol class="xtiers">${TIERS.map(([n, img], i) => `<li class="${lv > i ? 'on' : ''}${got.has(i + 1) ? ' got' : ''}"><img src="${img}" alt=""><b>第 ${i + 1} 層</b><small>${n}</small><em>${got.has(i + 1) ? '已拿到' : lv > i ? '賺 1 片雪花就拿到' : fmt(t.tiers[i]) + ' 盞'}</em></li>`).join('')}</ol>
    ${got.has(2) ? `<label class="xhat"><input type="checkbox" data-snow-hat${hatOn() ? ' checked' : ''}> 寵物島的夥伴戴聖誕帽</label>` : ''}
  </div>`;
}
export function bindTree(root) {
  root.querySelector('[data-snow-hat]')?.addEventListener('change', (e) => { setHat(e.target.checked); set(); });
}
// 剛亮到新的一層：告訴孩子拿到什麼
export function freshText() {
  const f = tree()?.fresh ?? [];
  if (!f.length) return '';
  return `大聖誕樹亮到第 ${f[f.length - 1]} 層了！你拿到：${f.map((k) => TIERS[k - 1][0]).join('、')}。`;
}
