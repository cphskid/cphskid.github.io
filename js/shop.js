// 時光幣、每日任務、商店（資料庫在 supabase/park_coins.sql）。
//
// 地圖右上角、名牌下面一顆「時光幣」：點了看餘額、本週冒險值、今天的 3 個每日任務（做到了按「領」）。
// 左下角護照上面一個「商店」：主角（換裝間的衣服）、寵物（點心）、傢俱（寵物島）、本月限定。
// 進樂園時，各遊戲新賺到的時光幣跳一次通知（「在島嶼開拓者賺了 130 時光幣！」）。
// 錢都是伺服器算的，這裡只負責顯示和按按鈕；資料庫還沒裝這份 SQL 時整個藏起來。
import * as auth from './auth.js';
import * as traveller from './traveller.js';
import * as passport from './passport.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COIN = '<img class="c" src="img/ui/coin.webp" alt="時光幣">';

const layer = $('#shop');
const chip = $('#coin-chip');
const btn = $('#shop-btn');
let hooks = { me: () => ({ kind: 'guest' }), toast: () => {} };
let st = null;       // park_coins_me 的結果；不是學生、沒裝 SQL 是 null

export function init(h) { hooks = { ...hooks, ...h }; }

export async function load(w = hooks.me()) {
  st = null;
  if (w.kind === 'student') {
    try { st = await auth.coins.me(); } catch { st = null; }
  }
  paintHud();
  if (st?.fresh?.length) announce(st.fresh);
  return st;
}

function canClaim() { return (st?.daily?.tasks ?? []).filter((t) => t.done && !t.claimed).length; }

function paintHud() {
  const on = !!st;
  chip.hidden = !on;
  btn.hidden = !on;
  if (!on) return;
  const n = canClaim();
  chip.innerHTML = `${COIN}<b>${st.balance}</b>${n ? `<i class="dot">${n}</i>` : ''}`;
  chip.setAttribute('aria-label', `時光幣 ${st.balance}${n ? `，有 ${n} 個每日任務可以領` : ''}`);
}

// 進樂園時跳一次「在哪裡賺了多少」
function announce(list) {
  const total = list.reduce((n, x) => n + x.amount, 0);
  const where = list.map((x) => x.name ?? '樂園').join('、');
  hooks.toast(`🪙 你在${where}賺了 ${total} 時光幣！`);
  chip.classList.add('boing');
  setTimeout(() => chip.classList.remove('boing'), 1200);
  auth.coins.seen().catch(() => {});
}

function show(html) {
  layer.innerHTML = html;
  layer.hidden = false;
  layer.onclick = (e) => { if (e.target === layer) close(); };
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
export function close() { layer.hidden = true; layer.innerHTML = ''; }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !layer.hidden) close(); });

// 換裝間買了衣服：餘額跟著變
addEventListener('park:coins', (e) => {
  if (st && e.detail?.balance != null) { st = { ...st, balance: e.detail.balance }; paintHud(); }
});

// ---------- 我的時光幣：餘額、本週冒險值、每日任務 ----------
export function openWallet(msg = null) {
  if (!st) return;
  const d = st.daily;
  const pct = Math.min(100, Math.round(st.week / st.goal * 100));
  const rows = d.tasks.map((t) => `<li class="${t.claimed ? 'got' : t.done ? 'ready' : ''}">
      <span class="tk">${t.claimed ? '✓' : ''}</span><b>${esc(t.name)}</b>
      ${t.claimed ? `<small>領過了</small>`
        : t.done ? `<button type="button" class="btn small coin" data-claim="${esc(t.code)}">${COIN}領 ${d.each}</button>`
        : `<small>還沒做到</small>`}</li>`).join('');
  show(`<div class="wallet" role="dialog" aria-modal="true" aria-label="我的時光幣">
    <button class="x" data-close aria-label="關閉"></button>
    <h2>我的時光幣</h2>
    <div class="bal">${COIN}<b>${st.balance}</b></div>
    <h3>本週冒險值 <small>這週新賺到的時光幣，週一重新算</small></h3>
    <div class="wk"><div class="bar"><i style="width:${pct}%"></i></div><b>${st.week} / ${st.goal}</b>
      ${myClasses().length ? '<button type="button" class="ghost small" data-board>🏆 班級排行</button>' : ''}</div>
    <h3>今天的任務 <small>每個 ${d.each}，全部完成再加 ${d.bonus}</small></h3>
    <ul class="daily">${rows}</ul>
    ${d.all ? '<p class="note ok">今天的任務都完成了，明天再來！</p>' : ''}
    ${msg ? `<p class="note ${msg[0]}">${esc(msg[1])}</p>` : ''}
    <p class="tip">去各座島過關、拿星星就會賺時光幣；重玩一整章也有，但一次比一次少。</p>
    <div class="row end"><button type="button" class="ghost" data-close>關閉</button>
      <button type="button" class="btn go" data-shop><img src="img/ui/shop.webp" alt="">去商店</button></div>
  </div>`);
  $('[data-shop]', layer).onclick = () => openShop();
  const bb = $('[data-board]', layer);
  if (bb) bb.onclick = () => openBoard();
  layer.querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await auth.coins.claim(b.dataset.claim);
        st = { ...st, ...r };
        sfx('SE-20');
        paintHud();
        openWallet(['ok', r.got > d.each ? `領到 ${r.got} 時光幣，今天全部完成！` : `領到 ${r.got} 時光幣！`]);
      } catch (err) {
        openWallet(['bad', err.message]);
      }
    };
  });
}

// ---------- 班級排行：本週冒險值、進步之星、勳章牆 ----------
// 只列前 10 名（0 分的不列），自己不在前 10 就在最下面說「你是第幾名」。點一個人看他的名片。
const myClasses = () => hooks.me()?.classes ?? [];
let boardCode = null;
let boardKind = 'week';
const PODIUM = ['🥇', '🥈', '🥉'];
const KINDS = [
  { id: 'week', name: '本週冒險值', tip: '這週新賺到的時光幣，每週一重新比。', unit: (n) => `${COIN}${n}`,
    mine: (r) => `你這週 ${r.score} 冒險值，全班第 ${r.rank} 名，加油！`, none: '你這週還沒有冒險值，去島上玩一關就上榜了！' },
  { id: 'up', name: '進步之星', tip: '這週比上週多賺了多少，跟自己比。', unit: (n) => `<em class="up">+${n}</em>`,
    mine: (r) => `你這週比上週多了 ${r.score}，全班第 ${r.rank} 名！`, none: '這週再多玩一點，比上週多就上榜了！' },
  { id: 'medals', name: '勳章牆', tip: '樂園護照上總共拿到幾枚勳章。', unit: (n) => `<em class="md-n">🏅${n}</em>`,
    mine: (r) => `你有 ${r.score} 枚勳章，全班第 ${r.rank} 名！`, none: '還沒有勳章，去島上過一關就能拿到第一枚！' },
];
export async function openBoard(code = boardCode ?? myClasses().find((c) => c.primary)?.code ?? myClasses()[0]?.code, kind = boardKind) {
  if (!code) return;
  boardCode = code;
  boardKind = kind;
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
  const cls = myClasses().length > 1 ? `<nav class="tabs cls" aria-label="班級">${myClasses().map((c) => `<button type="button" class="tab${c.code === code ? ' on' : ''}" data-cls="${esc(c.code)}">${esc(c.name || c.code)}</button>`).join('')}</nav>` : '';
  const kinds = `<nav class="tabs kinds" role="tablist" aria-label="比什麼">${KINDS.map((x) => `<button type="button" role="tab" class="tab${x.id === k.id ? ' on' : ''}" aria-selected="${x.id === k.id}" data-kind="${x.id}">${x.name}</button>`).join('')}</nav>`;
  const head = `<button class="x" data-close aria-label="關閉"></button><h2>🏆 班級排行</h2>${cls}${kinds}`;
  show(`<div class="wallet board" role="dialog" aria-modal="true" aria-label="班級排行">${head}<p class="tip">排行載入中…</p></div>`);
  bindBoard();
  let b;
  try { b = await auth.coins.board(code, k.id); } catch (err) { show(`<div class="wallet board">${head}<p class="note bad">${esc(err.message)}</p></div>`); bindBoard(); return; }
  if (boardCode !== code || boardKind !== kind) return;   // 等的時候又切到別的分頁
  const rows = b.rows.map((r) => `<li class="${r.me ? 'me' : ''}" data-card="${esc(r.id)}">
      <span class="rk">${PODIUM[r.rank - 1] ?? r.rank}</span>
      ${passport.avatarHtml(r.look, r.frame, '', r.medal)}
      <b>${esc(r.nickname)}${r.me ? '<small>（你）</small>' : ''}</b>
      <small class="md">${r.medal ? esc(r.medal.name) : ''}</small>
      <span class="pt">${k.unit(r.score)}</span></li>`).join('');
  const mine = b.me && !b.rows.some((r) => r.me) ? `<p class="note">${b.me.rank ? k.mine(b.me) : k.none}</p>` : '';
  show(`<div class="wallet board" role="dialog" aria-modal="true" aria-label="班級排行">${head}
    <p class="tip">${esc(b.name || b.code)}・${k.tip}頭像旁邊是每個人的代表勳章，點一下看名片。</p>
    ${rows ? `<ol class="rank">${rows}</ol>` : '<p class="tip">還沒有人上榜，第一個就是你！</p>'}
    ${mine}
  </div>`);
  bindBoard();
}
function bindBoard() {
  layer.querySelectorAll('[data-cls]').forEach((t) => { t.onclick = () => openBoard(t.dataset.cls, boardKind); });
  layer.querySelectorAll('[data-kind]').forEach((t) => { t.onclick = () => openBoard(boardCode, t.dataset.kind); });
  layer.querySelectorAll('[data-card]').forEach((li) => { li.onclick = () => { close(); passport.openCard(li.dataset.card); }; });
}

// ---------- 商店 ----------
const TABS = [
  { id: 'wear', name: '主角', tip: '時空旅人的衣服配件，買了在換裝間穿上' },
  { id: 'pet', name: '寵物', tip: '點心放進寵物的背包，餵了長得快' },
  { id: 'furn', name: '傢俱', tip: '買了擺在寵物島上，寵物會去玩' },
  { id: 'month', name: '本月限定', tip: '這個月才買得到，下個月就下架' },
];
let tab = 'wear';
let shop = null;
let pick = null;     // 主角分頁：正在看哪一件（左邊的旅人會穿上）

export async function openShop(msg = null) {
  if (!st) return;
  show('<div class="shop loading" role="dialog" aria-modal="true" aria-label="商店"><p>商店開門中…</p></div>');
  try { shop = await auth.coins.shop(); } catch (err) { show(`<div class="shop"><button class="x" data-close aria-label="關閉"></button><p class="note bad">${esc(err.message)}</p></div>`); return; }
  paintShop(msg);
}

function paintShop(msg = null) {
  const items = shop.items.filter((x) => x.cat === tab);
  const t = TABS.find((x) => x.id === tab);
  const look = traveller.state()?.look ?? null;
  const it = pick && items.find((x) => x.code === pick);
  const doll = tab === 'wear' && look ? `<div class="try">${traveller.dollHtml({ ...look, ...(it ? { [it.slot]: it.code } : {}) }, 'big')}
      <small>${it ? `穿上「${esc(it.name)}」的樣子` : '點一件看看穿起來的樣子'}</small></div>` : '';
  const card = (x) => {
    const own = x.owned && x.kind !== 'pet';
    return `<div class="sitem${own ? ' own' : ''}${x.code === pick ? ' on' : ''}" ${x.cat === 'wear' ? `data-look="${esc(x.code)}"` : ''}>
      <img class="art" src="${esc(x.art)}" alt="" loading="lazy">
      <b>${esc(x.name)}</b><small>${esc(x.blurb)}${x.qty ? `・背包裡有 ${x.qty} 個` : ''}</small>
      ${own ? '<span class="have">已經有了</span>'
        : `<button type="button" class="btn small coin" data-buy="${esc(x.code)}" ${st.balance < x.price ? 'disabled' : ''}>${COIN}${x.price}</button>`}
    </div>`;
  };
  const empty = tab === 'month' ? '這個月沒有限定商品，下個月再來看看。' : '還沒有東西。';
  show(`<div class="shop" role="dialog" aria-modal="true" aria-label="商店">
    <button class="x" data-close aria-label="關閉商店"></button>
    <div class="head"><h2><img src="img/ui/shop.webp" alt="">時空商店</h2>
      <button type="button" class="bal" data-wallet aria-label="我的時光幣">${COIN}<b>${st.balance}</b></button></div>
    <nav class="tabs" role="tablist" aria-label="商品分類">${TABS.map((x) => `<button type="button" role="tab" class="tab${x.id === tab ? ' on' : ''}" aria-selected="${x.id === tab}" data-tab="${x.id}">${x.name}${x.id === 'month' && shop.items.some((i) => i.cat === 'month') ? '<i class="new">新</i>' : ''}</button>`).join('')}</nav>
    <p class="lead">${esc(t.tip)}</p>
    ${msg ? `<p class="note ${msg[0]}">${esc(msg[1])}</p>` : ''}
    <div class="body${doll ? ' with-doll' : ''}">${doll}<div class="grid">${items.length ? items.map(card).join('') : `<p class="tip">${empty}</p>`}</div></div>
    ${tab === 'wear' ? '<div class="row end"><button type="button" class="ghost" data-ward>去換裝間</button></div>' : ''}
  </div>`);
  layer.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; pick = null; paintShop(); }; });
  layer.querySelectorAll('[data-look]').forEach((c) => { c.onclick = (e) => { if (e.target.closest('[data-buy]')) return; pick = c.dataset.look; paintShop(); }; });
  $('[data-wallet]', layer).onclick = () => openWallet();
  const ward = $('[data-ward]', layer);
  if (ward) ward.onclick = () => { close(); traveller.open(); };
  layer.querySelectorAll('[data-buy]').forEach((b) => {
    b.onclick = async () => {
      const x = shop.items.find((i) => i.code === b.dataset.buy);
      if (x.cat === 'wear') pick = x.code;
      if (!b.dataset.sure) {
        layer.querySelectorAll('[data-sure]').forEach((o) => { delete o.dataset.sure; o.lastChild.textContent = shop.items.find((i) => i.code === o.dataset.buy).price; });
        b.dataset.sure = '1';
        b.lastChild.textContent = `${x.price} 確定買？`;
        return;
      }
      b.disabled = true;
      try {
        shop = await auth.coins.buy(x.cat === 'wear' ? 'wear' : 'shop', x.code);
        st = { ...st, balance: shop.balance };
        if (x.cat === 'wear') traveller.gotItem(x.code);
        sfx('SE-20');
        paintHud();
        dispatchEvent(new CustomEvent('park:shop', { detail: { kind: x.kind ?? x.cat, code: x.code } }));
        paintShop(['ok', x.cat === 'wear' ? `買好了！去換裝間把「${x.name}」穿上吧。`
          : x.kind === 'furn' ? `買好了！「${x.name}」已經擺到寵物島上。` : `買好了！「${x.name}」放進寵物的背包了。`]);
      } catch (err) {
        paintShop(['bad', err.message]);
      }
    };
  });
}

chip.addEventListener('click', async () => {
  try { st = await auth.coins.me(); paintHud(); if (st?.fresh?.length) announce(st.fresh); } catch { /* 用手上的 */ }
  openWallet();
});
btn.addEventListener('click', () => openShop());
