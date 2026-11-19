// 聖誕活動「雪花聖誕村」（2026-11-19 串「提案島嶼風格與聖誕活動」，Chuck 選雪花 A 方案）
// 資料庫在 supabase/park_snow.sql：雪花結晶帳本（每天：滑雪 12＋學習設施 10＋每日任務 5＋寵物小遊戲 3）、降臨月曆、滑雪紀錄、全站大聖誕樹。
// 這裡管：活動狀態、寵物島右邊的兩顆按鈕（降臨月曆、雪山滑雪橇）、降臨月曆視窗、「今天的雪花」說明。
// 活動還沒開始、資料庫還沒裝好時什麼都不出現。
import * as auth from './auth.js';
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
function giftOf(day) {
  const g = GIFTS[day - 1];
  if (g[0] === 'snow') return { img: 'img/xmas/snow.webp', text: `雪花 ×${g[1]}` };
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
  const rows = [['ski', '雪山滑雪橇', '撿雪花、把禮物丟進煙囪'], ['learn', '去島上冒險', '開拓者、守護異世界、祕境島、試煉島過關'],
                ['daily', '每日任務', '全部做完'], ['pet', '寵物島小遊戲', '釣魚、澆果樹、烤點心']];
  return `<div class="snow-today"><p class="lab">今天的雪花 ${SNOW}</p>${rows.map(([k, n, how]) => {
    const got = st.today?.[k] ?? 0, cap = st.caps?.[k] ?? 0;
    return `<div class="srow${got >= cap ? ' done' : ''}"><b>${n}</b><small>${how}</small><span>${got}/${cap}</span></div>`;
  }).join('')}<small class="tip">每天最多 30 片；降臨月曆的雪花另外算。12/31 活動結束時，剩下的雪花每 10 片換 50 時光幣。</small></div>`;
}

// ---------- 降臨月曆 ----------
let veil = null;
function close() { veil?.remove(); veil = null; }
export function openAdvent({ onGift } = {}) {
  close();
  veil = document.createElement('div');
  veil.className = 'snow-veil';
  document.body.appendChild(veil);
  paint();
  function paint(msg = null) {
    const a = st.advent ?? { today: 0, opened: [], makeups: 0 };
    const op = new Map(a.opened.map((x) => [x.day, x]));
    const doors = Array.from({ length: 25 }, (_, i) => {
      const d = i + 1;
      if (op.has(d)) { const g = giftOf(d); return `<div class="door open"><img src="${g.img}" alt=""><small>${esc(g.text)}</small></div>`; }
      if (d === a.today) return `<button type="button" class="door today" data-day="${d}"><b>${d}</b><small>今天！</small></button>`;
      if (d < a.today) return `<button type="button" class="door miss" data-day="${d}"${a.makeups > 0 ? '' : ' disabled'}><b>${d}</b><small>${a.makeups > 0 ? '補開' : '沒開到'}</small></button>`;
      return `<div class="door later"><b>${d}</b></div>`;
    }).join('');
    veil.innerHTML = `<div class="snow-box advent" role="dialog" aria-modal="true" aria-label="降臨月曆">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="head"><img src="img/xmas/advent.webp" alt=""><div><h2>降臨月曆</h2>
        <p>12/1～12/25 每天開一格小禮物；第 25 格是麋鹿雪橇。沒開到的那天，完成當天的每日任務就能補開一格（現在可以補開 <b>${a.makeups}</b> 格）。</p></div>
        <span class="snow-bal">${SNOW}<b>${st.balance}</b></span></div>
      ${a.today === 0 ? '<p class="note">月曆 12/1 才開始，先去滑雪收集雪花吧！</p>' : ''}
      ${msg ? `<p class="note ${msg[0]}">${esc(msg[1])}</p>` : ''}
      <div class="doors">${doors}</div>
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
          const g = giftOf(+b.dataset.day);
          paint(['ok', `打開第 ${b.dataset.day} 格：${g.text}！${GIFTS[+b.dataset.day - 1][0] === 'furn' ? '已經放進寵物島的傢俱裡了。' : GIFTS[+b.dataset.day - 1][0] === 'pet' ? '放進寵物的背包了。' : ''}`]);
          veil.querySelector(`.door.open:nth-child(${b.dataset.day})`)?.classList.add('pop');
          onGift?.(r.gift);
        } catch (err) { paint(['bad', err.message]); }
      };
    });
  }
}
