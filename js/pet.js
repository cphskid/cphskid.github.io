// 主島桌寵（一期，資料庫在 supabase/park_pet.sql；規劃書「主島桌寵系統規劃」）。
//
// 地圖：樂園村莊上坐著自己的桌寵（還沒領養的是一顆會發光的時光蛋），餓了、生氣頭上會冒符號。
// 桌寵的窩：餵食、摸摸、改名，看長大進度；背包裡的點心只能從各島任務拿到。
// 規則（會不會餓、能不能吃、長大）全部由資料庫判斷，這裡只負責畫出來和講話。
//
// 正式美術（T 系列動作表）做好前，三隻先用頭像圖當佔位，動作由 CSS 做。
import * as auth from './auth.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const STAGE = ['', '幼年', '成長期', '完全體'];
const MOOD = { normal: '心情不錯', happy: '超開心', hungry: '肚子餓了', angry: '在生氣', asleep: '睡著了' };
const LINES = {
  normal: ['今天要去哪座島冒險？', '摸摸我嘛！', '我在窩裡等你回來喔。', '外面的島好像很好玩！'],
  happy:  ['最喜歡你了！', '嘿嘿，好舒服～', '今天也一起加油！'],
  hungry: ['肚子好餓…有沒有吃的？', '咕嚕咕嚕…我餓了啦'],
  angry:  ['哼！我不理你了！', '你都不餵我…（氣噗噗）'],
  sulky:  ['哼…吃飽了，可是我還在生氣，摸摸我才原諒你'],
  asleep: ['Zzz…（點一下叫醒牠）'],
  quiet:  ['上課中，我先睡一下，放學見！'],
};

let api = auth.pet;
let hooks = { me: () => ({ kind: 'guest' }), host: () => null, onChange: () => {} };
let state = null;            // park_pet_me() 的結果；null＝不是學生或資料庫還沒裝
let line = '';               // 桌寵現在說的話
let news = [];               // 剛拿到的道具（顯示一次）

const layer = $('#petroom');

// api：測試頁可以換成假的（tools/test/pet-preview.html）
export function init(h) {
  if (h.api) api = h.api;
  hooks = { ...hooks, ...h };
}

const myPet = () => state?.pets?.find((p) => p.active) ?? null;
const speciesName = (code) => state?.species?.find((s) => s.code === code)?.name ?? '';
const item = (code) => state?.items?.find((i) => i.code === code);
const art = (species) => `img/pet/${esc(species)}.webp`;
function moodOf(p) {
  if (state?.quiet) return 'quiet';
  return p.mood;
}

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
  if (!p) return '村莊裡有一顆會發光的時光蛋，點點看！';
  if (state.quiet) return null;
  if (p.mood === 'asleep') return `${p.name}在窩裡睡著了，去村莊叫醒牠吧！`;
  if (p.mood === 'angry') return `${p.name}好像在生氣，快回村莊餵牠吃東西！`;
  if (p.mood === 'hungry') return `${p.name}肚子餓了，回村莊餵牠吧！`;
  return null;
}

// ---------- 地圖上的桌寵 ----------
function paintMap() {
  const host = hooks.host();
  let el = $('#map-pet');
  if (!host || !state) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.id = 'map-pet';
    el.addEventListener('click', (e) => { e.stopPropagation(); if (!hooks.dragged?.()) open(); });
    host.appendChild(el);
  }
  const p = myPet();
  if (!p) {
    el.className = 'mp egg-wait';
    el.setAttribute('aria-label', '時光蛋：領養你的桌寵');
    el.innerHTML = '<span class="ride"><span class="egg"></span><img class="glint" src="img/fx/sparkle.webp" alt=""></span>';
    return;
  }
  const m = moodOf(p);
  const mark = { hungry: '!', angry: '💢', asleep: 'Zz', quiet: 'Zz', happy: '♥' }[m] ?? '';
  el.className = `mp m-${m} s-${p.stage}${news.length ? ' gift' : ''}`;
  el.setAttribute('aria-label', `我的桌寵${p.name}（${m === 'quiet' ? '上課時間在休息' : MOOD[m]}），點一下去窩裡看牠`);
  el.innerHTML = `<span class="ride">${mark ? `<span class="mp-bub">${mark}</span>` : ''}<img src="${art(p.species)}" alt=""></span>`;
}

// ---------- 外框 ----------
function show(html) {
  layer.innerHTML = html;
  layer.hidden = false;
  layer.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
}
export function close() {
  if (layer.hidden) return;
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
    <div><h2>桌寵的窩還在蓋</h2><p class="lead">${esc(msg)}</p>
    <div class="row"><button class="btn small" data-close>好</button></div></div></div>`);
}

export async function open() {
  if (hooks.me().kind !== 'student') return;
  if (!state) {
    try { state = await api.me(); } catch (e) { problem(e.missing ? '桌寵很快就會搬進樂園村莊，再等一下下！' : e.message); return; }
  }
  if (!myPet()) return openAdopt();
  line = '';
  paintRoom();
}

// ---------- 領養：選一隻（或隨機）→ 取名 → 孵蛋 ----------
function openAdopt() {
  let choice = null;
  const starters = state.species.filter((s) => s.starter);
  const paint = () => {
    const cards = starters.map((s) => `<button type="button" class="pal${choice === s.code ? ' on' : ''}" data-sp="${esc(s.code)}">
        <img src="${art(s.code)}" alt=""><b>${esc(s.name)}</b></button>`).join('')
      + `<button type="button" class="pal rnd${choice === 'random' ? ' on' : ''}" data-sp="random">
        <span class="egg"></span><b>隨機</b><small>孵出來才知道！</small></button>`;
    show(`<div class="den adopt" role="dialog" aria-modal="true" aria-label="領養桌寵">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="say"><img src="img/tick/excited.webp" alt="滴答"><p>這是一顆時光蛋！選一隻想要的夥伴，牠會住在樂園村莊陪你冒險。</p></div>
      <div class="pals">${cards}</div>
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
  const p = myPet();
  show(`<div class="den hatch" role="dialog" aria-modal="true" aria-label="孵蛋">
    <div class="egg big"></div><img class="pop" src="${art(p.species)}" alt="">
    <p>${esc(p.name)}孵出來了！</p></div>`);
  setTimeout(() => { line = `你好！我是${p.name}，以後請多多指教！`; paintRoom(); }, 2300);
}

// ---------- 桌寵的窩 ----------
function wish() {
  const inv = state.inventory ?? {};
  const want = state.items.filter((i) => i.kind === 'special' && !inv[i.code] && i.facility_name);
  if (!want.length) return '';
  const w = want[Math.floor(Date.now() / 3.6e6) % want.length];      // 每小時換一個想吃的
  return `<div class="wish"><span>${esc(w.icon)}</span><p>我好想吃<b>${esc(w.name)}</b>！在「${esc(w.facility_name)}」完成任務就拿得到喔。</p></div>`;
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

function paintRoom() {
  const p = myPet();
  const m = moodOf(p);
  if (!line) line = pick(LINES[m === 'angry' && p.sulky ? 'sulky' : m] ?? LINES.normal);
  const inv = state.inventory ?? {};
  const bag = state.items.map((i) => {
    const n = inv[i.code] ?? 0;
    return `<button type="button" class="food${n ? '' : ' none'}" data-feed="${esc(i.code)}" ${n && m !== 'quiet' ? '' : 'disabled'}
      aria-label="餵${esc(i.name)}（還有 ${n} 個）"><span class="ic">${esc(i.icon)}</span><b>${esc(i.name)}</b><small>× ${n}</small></button>`;
  }).join('');
  const pct = p.next_xp ? Math.min(100, Math.round(p.xp / p.next_xp * 100)) : 100;
  show(`<div class="den" role="dialog" aria-modal="true" aria-label="${esc(p.name)}的窩">
    <button class="x" data-close aria-label="關閉，回到地圖"></button>
    <section class="nest">
      <div class="bubble">${esc(line)}</div>
      <button type="button" class="pet m-${m} s-${p.stage}" data-pat aria-label="摸摸${esc(p.name)}"><img src="${art(p.species)}" alt=""></button>
      <div class="rug"></div>
    </section>
    <section class="info">
      ${newsHtml()}
      <div class="nm"><h2>${esc(p.name)}</h2><button type="button" class="ghost small" data-rename>改名</button></div>
      <p class="kind">${esc(speciesName(p.species))}・${STAGE[p.stage]}・<span class="mood m-${m}">${m === 'quiet' ? '上課時間在休息' : MOOD[m]}</span></p>
      <div class="xp" aria-label="長大進度"><i style="width:${pct}%"></i></div>
      <small class="xpt">${p.next_xp ? `再 ${p.next_xp - p.xp} 點長成${STAGE[p.stage + 1]}（吃點心長得最快）` : '已經是完全體了！'}</small>
      <h3>背包</h3>
      <div class="bag">${bag}</div>
      <div class="row"><button type="button" class="btn small" data-pat ${m === 'quiet' ? 'disabled' : ''}>${m === 'asleep' ? '叫醒牠' : '摸摸'}</button></div>
      ${wish()}
      <p class="msg" hidden></p>
    </section></div>`);
  news = [];
  layer.querySelectorAll('[data-pat]').forEach((b) => { b.onclick = () => act('pat'); });
  layer.querySelectorAll('[data-feed]').forEach((b) => { b.onclick = () => act('feed', b.dataset.feed); });
  $('[data-rename]', layer).onclick = rename;
}
let busy = false;
async function act(kind, code) {
  if (busy || state.quiet) return;
  busy = true;
  const pet = $('.pet', layer);
  try {
    const r = kind === 'feed' ? await api.feed(code) : await api.pat();
    state = { ...state, ...r, granted: [] };
    const p = myPet();
    line = reply(r, p, code);
    paintRoom();
    const el = $('.pet', layer);
    if (kind === 'feed') { el.classList.add('eat'); floatUp(item(code)?.icon ?? '✨', r.xp); }
    else if (p.mood === 'happy') { el.classList.add('wag'); floatUp('♥', r.xp); }
    else el.classList.add('nope');
  } catch (err) {
    line = err.message;
    paintRoom();
    pet?.classList.add('nope');
  } finally {
    busy = false;
  }
}
function reply(r, p, code) {
  if (r.did === 'feed') {
    if (r.was === 'angry') return pick(LINES.sulky);
    const i = item(code);
    return i?.kind === 'special' ? `哇！是${i.name}！最好吃了！` : pick(['好好吃！謝謝你！', '吃飽飽，好滿足～', '嗯嗯，好香！']);
  }
  if (r.was === 'asleep') return '嗯…？你回來了！我睡好久，肚子好餓喔';
  if ((r.was === 'hungry' || r.was === 'angry') && p.mood !== 'happy') return r.was === 'angry' ? pick(LINES.angry) + '（先餵我啦）' : '肚子好餓…先餵我吃東西嘛';
  if (r.was === 'angry') return '好啦好啦，原諒你了！';
  return pick(LINES.happy);
}
function floatUp(t, xp) {
  const nest = $('.nest', layer);
  if (!nest) return;
  const f = document.createElement('span');
  f.className = 'float';
  f.textContent = t + (xp ? ` +${xp}` : '');
  nest.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}

function rename() {
  const p = myPet();
  const box = $('.nm', layer);
  box.innerHTML = `<form class="rn" novalidate><input maxlength="8" value="${esc(p.name)}" aria-label="新名字"><button class="btn small" type="submit">好了</button></form>`;
  const f = $('form', box);
  $('input', f).focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      state = { ...state, ...(await api.rename($('input', f).value.trim())), granted: [] };
      line = '這個名字我好喜歡！';
      paintRoom();
    } catch (err) {
      const msg = $('.msg', layer);
      msg.textContent = err.message; msg.hidden = false;
    }
  };
}
