// 樂園護照與頭像（P4，資料庫在 supabase/park_passport.sql）。
//
// 護照：每個遊戲一頁，蓋過的章亮起來、沒蓋過的是淡淡的空格加上「怎麼拿到」。
//       剛蓋的新章第一次打開時會「咚」一聲蓋下去，看過就不再播。
// 頭像：一開始 12 個可以選，其他的靠蓋章、蓋滿一頁解鎖；頭像框也一樣。
// 解鎖條件一律由資料庫判斷，這裡只負責畫出來。
import * as auth from './auth.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;

const layer = $('#pass');
let hooks = { me: () => ({ kind: 'guest' }), changed: () => {} };
let book = null;          // park_passport() 的結果
let page = 0;

export function init(h) { hooks = { ...hooks, ...h }; }

// 頭像＋框。沒選過頭像的人先用滴答。
export function avatarHtml(avatar, frame = 'plain', cls = '') {
  const img = avatar
    ? `<img src="img/avatar/${esc(avatar)}.webp" alt="">`
    : '<img class="none" src="img/tick/happy.webp" alt="">';
  return `<span class="av fr-${esc(frame || 'plain')}${cls ? ' ' + cls : ''}">${img}</span>`;
}

// 每個章蓋下去的角度固定（同一個章每次打開都一樣歪），看起來像真的蓋的
function tilt(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 17) - 8) + 'deg';
}
const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

// short：選頭像格子底下的小字（太長會擠）；點下去的說明用完整的
function needText(r, short = false) {
  if (r.need_page === '*') return '蓋滿任何一頁';
  if (r.need_page) return short ? '蓋滿一整頁' : `蓋滿「${r.need_page_name ?? r.need_page}」那一頁`;
  return `${r.need_stamps} 個章`;
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
}
layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function problem(e) {
  show(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="樂園護照">
    <button class="x" data-close aria-label="關閉"></button>
    <img class="tick" src="img/tick/${e.missing ? 'thinking' : 'worried'}.webp" alt="">
    <div><h2>${e.missing ? '護照還在印' : '打不開護照'}</h2>
    <p class="lead">${esc(e.missing ? '樂園護照還在準備中，很快就能用了！先去遊戲裡玩，完成的任務之後都會補蓋章。' : e.message)}</p>
    <div class="row"><button class="btn small" data-close>好</button></div></div></div>`);
}

async function load() {
  book = await auth.passport.book();
  return book;
}

// ---------- 護照 ----------
export async function openPassport({ facility } = {}) {
  const w = hooks.me();
  if (w.kind !== 'student') return;
  show('<div class="book loading" role="dialog" aria-modal="true" aria-label="樂園護照"><img src="img/ui/passport.webp" alt=""><p>翻開護照中…</p></div>');
  try { await load(); } catch (e) { problem(e); return; }
  const pages = book.pages ?? [];
  page = Math.max(0, pages.findIndex((p) => p.facility === facility));
  if (!facility) page = Math.max(0, pages.findIndex((p) => p.stamps.some((s) => s.new)));
  render();
  // 新章看過了：動畫只播一次。右上角的「新章」也一起消掉。
  if (pages.some((p) => p.stamps.some((s) => s.new))) {
    auth.passport.seen().then(() => hooks.changed({ unseen: [] })).catch(() => {});
  }
}

function render() {
  const w = hooks.me();
  const pages = book.pages ?? [];
  const p = pages[page];
  const total = book.stamps ?? 0;
  const freshTotal = pages.reduce((n, x) => n + x.stamps.filter((s) => s.new).length, 0);

  // 下一個獎勵：還差最少章數的那一個
  const locked = book.rewards.filter((r) => !r.unlocked && !r.need_page).sort((a, b) => a.need_stamps - b.need_stamps);
  const next = locked[0];
  // 這次新蓋的章剛好解鎖的（看過護照之前的章數還不夠的那些）
  const fresh = book.rewards.filter((r) => r.unlocked && !r.need_page && r.need_stamps > 0 && r.need_stamps > total - freshTotal);

  const tabs = pages.map((x, i) => {
    const got = x.stamps.filter((s) => s.at).length;
    const n = x.stamps.filter((s) => s.new).length;
    return `<button type="button" class="ptab${i === page ? ' on' : ''}" data-page="${i}">
      <img src="img/badge/${esc(x.zone)}.webp" alt="" onerror="this.src='img/ui/passport.webp'">
      <span><b>${esc(x.name)}</b><small>${got} / ${x.stamps.length} 個章${x.full ? '・蓋滿了' : ''}</small></span>
      ${n ? `<i class="new">新 ${n}</i>` : ''}</button>`;
  }).join('');

  const cell = (s, i) => {
    const style = `style="--r:${tilt(p.facility + s.code)};--i:${i}"`;
    if (s.at) {
      return `<div class="stamp got${s.new ? ' fresh' : ''}" ${style}>
        <div class="slot"><img src="${esc(s.art)}" alt=""></div>
        <b>${esc(s.name)}</b><small>${md(s.at)} 蓋章</small></div>`;
    }
    if (!s.active) {
      return `<div class="stamp soon" ${style}><div class="slot"><img src="${esc(s.art)}" alt=""><img class="lock" src="img/ui/lock.webp" alt=""></div>
        <b>${esc(s.name)}</b><small>即將開放</small></div>`;
    }
    return `<div class="stamp" ${style}><div class="slot"><img src="${esc(s.art)}" alt=""></div>
      <b>${esc(s.name)}</b><small>${esc(s.hint)}</small></div>`;
  };

  const got = p ? p.stamps.filter((s) => s.at).length : 0;
  show(`<div class="book" role="dialog" aria-modal="true" aria-label="樂園護照">
    <button class="x" data-close aria-label="關閉護照"></button>
    <section class="leaf left">
      <div class="owner">${avatarHtml(book.avatar, book.frame, 'big')}
        <div><small>時空冒險樂園・護照</small><b>${esc(w.nickname)}</b>
        <span>已經蓋了 <em>${total}</em> 個章</span></div></div>
      <button type="button" class="btn small" data-avatar>換頭像</button>
      <nav class="ptabs" aria-label="選一個遊戲的那一頁">${tabs || '<p class="tip">還沒有遊戲提供護照章。</p>'}</nav>
      ${fresh.length ? `<div class="unlock"><img src="img/fx/sparkle.webp" alt=""><p><b>新解鎖！</b>${fresh.map((r) => esc(r.name)).join('、')}，按「換頭像」換上去吧。</p></div>`
        : next ? `<div class="next">${next.kind === 'avatar' ? avatarHtml(next.code, 'plain', 'mini') : avatarHtml(book.avatar, next.code, 'mini')}
          <p>再蓋 <b>${next.need_stamps - total}</b> 個章，就能解鎖${next.kind === 'avatar' ? '頭像' : '頭像框'}「${esc(next.name)}」</p></div>` : ''}
    </section>
    <section class="leaf right">
      ${p ? `<h2>${esc(p.name)}</h2>
      <p class="lead">這一頁蓋了 ${got} / ${p.stamps.length} 個章</p>
      <div class="grid">${p.stamps.map(cell).join('')}</div>
      ${p.full ? '<div class="full">這一頁蓋滿了！</div>' : ''}` : '<p class="lead">護照還是空的，去遊戲裡完成任務就會蓋章！</p>'}
    </section></div>`);

  layer.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { page = +b.dataset.page; clearFresh(); render(); }; });
  $('[data-avatar]', layer).onclick = () => openAvatar({ back: true });
  if (!reduceMotion) layer.querySelectorAll('.stamp.fresh').forEach((el, i) => sparkle(el, i));
}

// 只有第一次打開時播「新章」動畫；翻到別頁再翻回來就不再播
function clearFresh() {
  for (const x of book.pages) for (const s of x.stamps) s.new = false;
}

function sparkle(el, i) {
  setTimeout(() => {
    const img = document.createElement('img');
    img.src = 'img/fx/star-burst.webp';
    img.className = 'stamp-burst';
    img.alt = '';
    el.appendChild(img);
    img.addEventListener('animationend', () => img.remove());
  }, 450 + i * 350);
}

// ---------- 換頭像 ----------
// first：第一次登入時自動打開（歡迎詞不同）；back：從護照來的，存好回護照
export async function openAvatar({ first = false, back = false } = {}) {
  const w = hooks.me();
  if (w.kind !== 'student') return;
  if (!book || !back) {
    show('<div class="book loading" role="dialog" aria-modal="true"><img src="img/ui/passport.webp" alt=""><p>拿出頭像…</p></div>');
    try { await load(); } catch (e) { if (!first) problem(e); else close(); return; }
  }
  let av = book.avatar ?? null;
  let fr = book.frame ?? 'plain';
  const avatars = book.rewards.filter((r) => r.kind === 'avatar');
  const frames = book.rewards.filter((r) => r.kind === 'frame');
  const nameOf = (code) => book.rewards.find((r) => r.code === code)?.name ?? '';

  const paint = () => {
    show(`<div class="sheet picker" role="dialog" aria-modal="true" aria-label="選頭像">
      <button class="x" data-close aria-label="關閉"></button>
      <div class="pv">${avatarHtml(av, fr, 'huge')}<b>${esc(av ? nameOf(av) : '還沒選')}</b>
        <p>${first ? `歡迎你，${esc(w.nickname)}！挑一個代表你的頭像吧，之後隨時可以換。` : '蓋越多章，可以選的頭像和框越多。'}</p></div>
      <div class="choose">
        <h3>頭像</h3>
        <div class="avs">${avatars.map((r) => `<button type="button" class="pick${r.unlocked ? '' : ' locked'}${av === r.code ? ' on' : ''}" data-av="${esc(r.code)}" aria-label="${esc(r.name)}${r.unlocked ? '' : '（還沒解鎖）'}">
          ${avatarHtml(r.code)}${r.unlocked ? '' : `<span class="need"><img src="img/ui/lock.webp" alt="">${esc(needText(r, true))}</span>`}</button>`).join('')}</div>
        <h3>頭像框</h3>
        <div class="frs">${frames.map((r) => `<button type="button" class="pick${r.unlocked ? '' : ' locked'}${fr === r.code ? ' on' : ''}" data-fr="${esc(r.code)}" aria-label="${esc(r.name)}${r.unlocked ? '' : '（還沒解鎖）'}">
          ${avatarHtml(av, r.code)}<span class="nm">${esc(r.name)}</span>${r.unlocked ? '' : `<span class="need"><img src="img/ui/lock.webp" alt="">${esc(needText(r, true))}</span>`}</button>`).join('')}</div>
        <p class="msg" hidden></p>
        <div class="row end">${back ? '<button type="button" class="ghost" data-back>回護照</button>' : ''}
          <button type="button" class="btn go" data-save>${first ? '就決定是你了！' : '換上去'}</button></div>
      </div></div>`);

    const msg = $('.msg', layer);
    const say = (t, ok = false) => { msg.textContent = t; msg.className = 'msg' + (ok ? ' ok' : ''); msg.hidden = !t; };
    const lockedSay = (r) => say(`「${r.name}」還沒解鎖，要${r.need_page ? '' : '總共蓋到 '}${needText(r)}才能用。`);
    layer.querySelectorAll('[data-av]').forEach((b) => {
      b.onclick = () => {
        const r = avatars.find((x) => x.code === b.dataset.av);
        if (!r.unlocked) return lockedSay(r);
        av = r.code; paint();
      };
    });
    layer.querySelectorAll('[data-fr]').forEach((b) => {
      b.onclick = () => {
        const r = frames.find((x) => x.code === b.dataset.fr);
        if (!r.unlocked) return lockedSay(r);
        fr = r.code; paint();
      };
    });
    const backBtn = $('[data-back]', layer);
    if (backBtn) backBtn.onclick = () => render();
    $('[data-save]', layer).onclick = async (e) => {
      if (!av) return say('先點一個頭像喔');
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const p = await auth.passport.setAvatar(av, fr);
        book.avatar = p.avatar; book.frame = p.frame;
        hooks.changed({ avatar: p.avatar, frame: p.frame });
        if (back) render(); else close();
      } catch (err) {
        say(err.message);
        b.disabled = false;
      }
    };
  };
  paint();
}
