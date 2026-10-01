// 樂園的登入、註冊、老師入口、我的資料。畫面都是木框卡片，疊在地圖上面。
//
// 小朋友是國小學生：填錯了要「講出哪裡不對」，不要讓按鈕變暗不說話（守護異世界踩過的坑）。
import * as auth from './auth.js';
import * as passport from './passport.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const layer = $('#acct');
const chip = $('#me-chip');
let who = { kind: 'guest' };
let onChange = () => {};
let pending = null;          // requireLogin() 等著的那個 Promise

// ?join=班級代碼：老師分享的連結，直接打開「第一次來」並把代碼填好
const joinCode = (() => {
  const raw = new URLSearchParams(location.search).get('join') ?? '';
  return /^[A-Za-z0-9]{3,12}$/.test(raw) ? raw.toUpperCase() : '';
})();
export const hasJoinLink = joinCode !== '';

export function current() { return who; }
// 帳號功能有沒有載入（supabase.js 載不到時，地圖照常可以逛，只是不能登入）
export const available = !!auth.db;

// 學生另外帶回頭像、章數、還沒看過的新章（P4；資料庫還沒裝就是 null，畫面退回滴答）
async function loadWho() {
  let w;
  try { w = await auth.me(); } catch { w = { kind: 'guest' }; }
  if (w.kind === 'student') {
    try { w.profile = await auth.passport.myProfile(); } catch { w.profile = null; }
  }
  return w;
}

let ready = null;
export function init(cb) {
  onChange = cb ?? onChange;
  ready = (async () => {
    who = await loadWho();
    paintChip();
    return who;
  })();
  return ready;
}

async function refresh() {
  who = await loadWho();
  paintChip();
  onChange(who);
  return who;
}

// 護照那邊換了頭像、看過新章：只更新頭像這一塊，不用整個重問
passport.init({
  me: () => who,
  changed(patch) {
    if (who.kind !== 'student' || !who.profile) return;
    Object.assign(who.profile, patch);
    paintChip();
    dispatchEvent(new CustomEvent('park:profile', { detail: who.profile }));
  },
});
export const openPassport = passport.openPassport;
export const openAvatar = passport.openAvatar;
export const avatarHtml = passport.avatarHtml;

// 右上角「我是誰」：共用平板一眼看得出現在是誰登入的
function paintChip() {
  if (!auth.db) { chip.hidden = true; return; }
  chip.hidden = false;
  if (who.kind === 'student') {
    const p = who.profile;
    const n = p?.unseen?.length ?? 0;
    chip.innerHTML = `${passport.avatarHtml(p?.avatar, p?.frame, 'chip')}<span><b>${esc(who.nickname)}</b><small>${n ? `<i class="new">新章 ×${n}</i>` : '我的資料'}</small></span>`;
  }
  else if (who.kind === 'staff') chip.innerHTML = `<img src="img/tick/point.webp" alt=""><span><b>${esc(who.display_name)}</b><small>${who.is_admin ? '管理員' : '老師／家長'}</small></span>`;
  else chip.innerHTML = `<img src="img/tick/wave.webp" alt=""><span><b>登入</b><small>還沒登入</small></span>`;
}
chip.addEventListener('click', () => {
  if (who.kind === 'student') openProfile();
  else if (who.kind === 'staff') openStaffHome();
  else requireLogin();
});

// ---------- 卡片外框 ----------
function show(html, { tick = 'wave', wide = false } = {}) {
  layer.innerHTML = `<div class="card acct${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
    <button class="x" data-close aria-label="關閉"></button>
    <div class="art"><img class="tick" src="img/tick/${tick}.webp" alt="導覽員滴答"></div>
    <div class="body">${html}</div></div>`;
  layer.hidden = false;
  $('[data-close]', layer).onclick = close;
  const first = $('input:not([type=checkbox]),.btn', layer);
  if (first && matchMedia('(pointer:fine)').matches) first.focus();
}
export function close() {
  if (layer.hidden) return;
  layer.hidden = true;
  layer.innerHTML = '';
  if (pending) { pending.resolve(who.kind === 'guest' ? null : who); pending = null; }
}
layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

function busy(form, on, label) {
  const b = $('button[type=submit]', form);
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = label ?? '請稍等…'; b.disabled = true; }
  else { b.textContent = b.dataset.label ?? b.textContent; b.disabled = false; }
}
function say(form, msg, ok = false) {
  const p = $('.msg', form);
  p.textContent = msg ?? '';
  p.className = 'msg' + (ok ? ' ok' : '');
  p.hidden = !msg;
}
// 表單送出的共同流程：先檢查、再呼叫、錯誤顯示在表單下面
function onSubmit(form, problem, action) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('button[type=submit]', form)?.disabled) return;
    const bad = problem();
    if (bad) return say(form, bad);
    say(form, null);
    busy(form, true);
    try { await action(); }
    catch (err) { say(form, err.message); }
    finally { if (form.isConnected) busy(form, false); }
  });
}

// ---------- 要求登入：Start Game、進設施之前 ----------
// 已經登入就直接回來；沒有就打開學生登入卡，登入成功或關掉時才回來（關掉回 null）
export async function requireLogin() {
  await ready;
  if (who.kind !== 'guest') return who;
  if (!auth.db) return null;
  if (pending) return pending.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  pending = { promise, resolve };
  openLogin(joinCode ? 'register' : 'login');
  return promise;
}
async function loggedIn() {
  await refresh();
  const p = pending;
  pending = null;
  layer.hidden = true;
  layer.innerHTML = '';
  p?.resolve(who);
  // 第一次登入、還沒選過頭像：請他挑一個（資料庫還沒裝護照時 profile 是 null，就不問）
  if (who.kind === 'student' && who.profile && !who.profile.avatar) setTimeout(() => passport.openAvatar({ first: true }), 700);
}

// ---------- 學生：我有帳號／第一次來 ----------
function openLogin(tab = 'login') {
  const reg = tab === 'register';
  show(`
    <h2>${reg ? '第一次來樂園' : '登入樂園'}</h2>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="${reg ? '' : 'on'}" data-tab="login">我有帳號</button>
      <button type="button" role="tab" class="${reg ? 'on' : ''}" data-tab="register">第一次來</button>
    </div>
    <form class="form" novalidate>
      ${reg ? `<label>班級代碼<input name="code" value="${esc(joinCode)}" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="老師給你的代碼"></label>` : ''}
      <label>帳號<input name="id" maxlength="16" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="英文或數字，例如 ming123"></label>
      <label>密碼<input name="pw" type="password" maxlength="32" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="6 個以上的英文或數字"></label>
      ${reg ? `<label>暱稱<input name="nick" maxlength="16" autocomplete="off" placeholder="大家看得到的名字，例如 小雷"></label>` : ''}
      <p class="msg" hidden></p>
      <button class="btn go" type="submit">${reg ? '建立帳號' : '進入樂園'}</button>
    </form>
    <p class="tip">${reg
      ? (joinCode ? '班級代碼已經幫你填好了。' : '') + '帳號是登入用的，暱稱是大家看得到的名字。不用真實姓名，也不用 email。'
      : '在守護異世界註冊過的，直接用同一組帳號密碼。忘記密碼請老師幫你重設。'}</p>
    <button type="button" class="link" data-staff>我是老師／家長 ›</button>`, { tick: reg ? 'cheer' : 'wave' });

  layer.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => openLogin(b.dataset.tab); });
  $('[data-staff]', layer).onclick = () => openStaff();
  const f = $('form', layer);
  const v = (n) => (f.elements[n]?.value ?? '').trim();
  // 帳號只留英數底線、轉小寫；代碼轉大寫（跟守護異世界一樣）
  f.elements.id.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9_]/g, '').toLowerCase(); });
  f.elements.code?.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); });

  onSubmit(f, () => {
    if (reg && v('code').length < 3) return '要填老師給你的班級代碼';
    const id = v('id');
    if (!id) return '要先填帳號喔';
    if (id.length < 3) return '帳號太短了，至少 3 個字';
    if (v('pw').length < 6) return `密碼至少要 6 個字（現在 ${v('pw').length} 個）`;
    if (reg && !v('nick')) return '取一個暱稱吧，那是大家會看到的名字';
    return null;
  }, async () => {
    if (reg) await auth.studentRegister(v('id'), f.elements.pw.value, v('nick'), v('code'));
    else await auth.studentLogin(v('id'), f.elements.pw.value);
    await loggedIn();
  });
}

// ---------- 老師／家長：登入／第一次使用 ----------
// 老師後台（teacher.html）的「建立帳號」連到 /?staff=signup，會直接打開這張
export function openStaffPanel(tab) { openStaff(tab === 'signup' ? 'signup' : 'login'); }
function openStaff(tab = 'login') {
  const reg = tab === 'signup';
  show(`
    <h2>老師／家長</h2>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="${reg ? '' : 'on'}" data-tab="login">登入</button>
      <button type="button" role="tab" class="${reg ? 'on' : ''}" data-tab="signup">第一次使用</button>
    </div>
    <form class="form" novalidate>
      <label>email<input name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@school.edu.tw"></label>
      <label>密碼<input name="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="至少 8 個字"></label>
      ${reg ? `<label>你的稱呼<input name="name" maxlength="16" autocomplete="off" placeholder="學生會看到，例如 王老師、小明媽媽"></label>
      <label class="check"><input name="adult" type="checkbox"> 我是老師或家長，年滿 18 歲</label>` : ''}
      <p class="msg" hidden></p>
      <button class="btn go" type="submit">${reg ? '建立開班帳號' : '登入'}</button>
    </form>
    <p class="tip">${reg
      ? '不用收確認信，建好馬上可以開班。一個帳號最多 3 個班、每班 40 人，不夠用請找管理員。'
      : '守護異世界的老師帳號可以直接登入。'}</p>
    <button type="button" class="link" data-student>‹ 回學生登入</button>`, { tick: 'point' });

  layer.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => openStaff(b.dataset.tab); });
  $('[data-student]', layer).onclick = () => openLogin();
  const f = $('form', layer);
  const v = (n) => (f.elements[n]?.value ?? '').trim();
  onSubmit(f, () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) return 'email 看起來不太對，再檢查一下';
    if (f.elements.pw.value.length < 8) return `密碼至少要 8 個字（現在 ${f.elements.pw.value.length} 個）`;
    if (reg && !v('name')) return '填一下你的稱呼，學生會看到';
    if (reg && !f.elements.adult.checked) return '請勾選「我是老師或家長，年滿 18 歲」';
    return null;
  }, async () => {
    if (reg) await auth.staffSignUp(v('email'), f.elements.pw.value, v('name'), true);
    else await auth.staffLogin(v('email'), f.elements.pw.value);
    await loggedIn();
    location.href = 'teacher.html';   // 老師登入後直接進後台
  });
}

// ---------- 老師入口：身分、認領管理員、進老師後台（teacher.html） ----------
function openStaffHome() {
  const w = who;
  show(`
    <h2>${esc(w.display_name)}，你好</h2>
    <div class="chips"><span class="chip">${w.is_admin ? '管理員' : '開班帳號'}</span>${w.email ? `<span class="chip">${esc(w.email)}</span>` : ''}${w.class_count != null ? `<span class="chip">開了 ${w.class_count} 個班</span>` : ''}</div>
    ${w.has_admin === false ? `<div class="fac"><h3>這個系統還沒有管理員</h3><p>你是第一個使用者的話，按下面的按鈕成為管理員。有了管理員之後，這顆按鈕就沒有作用了。</p>
      <form class="form" data-claim><p class="msg" hidden></p><button class="btn go" type="submit">我是第一個使用者</button></form></div>` : ''}
    <div class="fac"><h3>老師後台</h3><p>開班、選年級、決定班上開放哪些遊戲、看全班在各遊戲的進度、幫學生重設密碼，都在這裡。${w.is_admin ? '管理員的設施與老師管理也在裡面。' : ''}</p>
      <div class="row"><a class="btn go" href="teacher.html">進入老師後台</a></div></div>
    <div class="row end"><button type="button" class="ghost" data-map>逛逛樂園地圖</button><button type="button" class="ghost" data-logout>登出</button></div>`,
  { tick: 'point', wide: true });

  $('[data-map]', layer).onclick = close;
  $('[data-logout]', layer).onclick = logout;
  const claim = $('[data-claim]', layer);
  if (claim) onSubmit(claim, () => null, async () => {
    await auth.claimFirstAdmin();
    await refresh();
    openStaffHome();
  });
}

// ---------- 學生：我的資料 ----------
function classRow(c) {
  const right = c.primary
    ? '<span class="chip open" title="守護異世界的排行榜用這個班">主要班級</span>'
    : `<button type="button" class="ghost small" data-leave="${esc(c.code)}">退出</button>`;
  return `<li><div><b>${esc(c.name || '（沒有班名）')}</b><small>${esc(c.code)}${c.owner_name ? '・' + esc(c.owner_name) : ''}</small></div>${right}</li>`;
}
function openProfile(section = '') {
  const w = who;
  const classes = w.classes ?? [];
  const p = w.profile;
  show(`
    <div class="me-head">${passport.avatarHtml(p?.avatar, p?.frame, 'big')}<div>
    <h2>${esc(w.nickname)}</h2>
    <p class="lead">${w.login_id ? `登入帳號 <b>${esc(w.login_id)}</b>・` : ''}暱稱在所有遊戲都一樣</p>
    <div class="row"><button type="button" class="btn small" data-passport>樂園護照${p?.stamps ? `（${p.stamps} 個章）` : ''}</button>
      <button type="button" class="ghost small" data-avatar>換頭像</button></div></div></div>

    <h3>我的班級</h3>
    ${classes.length ? `<ul class="classes">${classes.map(classRow).join('')}</ul>` : '<p class="tip">還沒有加入任何班級。</p>'}
    ${w.legacy ? '<p class="tip">加入多個班的功能還沒裝到資料庫。</p>' : `
    <form class="form inline" data-join novalidate>
      <input name="code" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="輸入另一個班的代碼" aria-label="班級代碼">
      <button class="btn small" type="submit">加入</button>
      <p class="msg" hidden></p>
    </form>`}

    <details ${section === 'nick' ? 'open' : ''}><summary>改暱稱</summary>
      <form class="form inline" data-nick novalidate>
        <input name="nick" maxlength="16" value="${esc(w.nickname)}" autocomplete="off" aria-label="新暱稱">
        <button class="btn small" type="submit">儲存</button>
        <p class="msg" hidden></p>
      </form><p class="tip">一週只能改一次。主要班級裡不能跟別人重複。</p></details>
    <details ${section === 'pw' ? 'open' : ''}><summary>改密碼</summary>
      <form class="form" data-pw novalidate>
        <label>現在的密碼<input name="old" type="password" autocomplete="current-password"></label>
        <label>新密碼<input name="pw" type="password" maxlength="32" autocomplete="new-password" placeholder="6 個以上的英文或數字"></label>
        <p class="msg" hidden></p>
        <button class="btn small" type="submit">改密碼</button>
      </form></details>

    <div class="row end"><button type="button" class="ghost" data-logout>登出</button></div>`,
  { tick: 'happy', wide: true });

  $('[data-logout]', layer).onclick = logout;
  $('[data-passport]', layer).onclick = () => { close(); passport.openPassport(); };
  $('[data-avatar]', layer).onclick = () => { close(); passport.openAvatar(); };
  layer.querySelectorAll('[data-leave]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`確定要退出 ${b.dataset.leave} 這個班嗎？`)) return;
      b.disabled = true;
      try { await auth.leaveClass(b.dataset.leave); await refresh(); openProfile(); }
      catch (err) { alert(err.message); b.disabled = false; }
    };
  });

  const jf = $('[data-join]', layer);
  if (jf) {
    jf.elements.code.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); });
    onSubmit(jf, () => (jf.elements.code.value.trim().length < 3 ? '要填老師給你的班級代碼' : null), async () => {
      const r = await auth.joinClass(jf.elements.code.value);
      await refresh();
      openProfile();
      say($('[data-join]', layer), `加入「${r?.name || r?.code}」了！`, true);
    });
  }

  const nf = $('[data-nick]', layer);
  onSubmit(nf, () => (nf.elements.nick.value.trim() ? null : '暱稱不能空白'), async () => {
    await auth.setNickname(nf.elements.nick.value);
    await refresh();
    openProfile('nick');
    say($('[data-nick]', layer), '暱稱改好了', true);
  });

  const pf = $('[data-pw]', layer);
  onSubmit(pf, () => {
    if (!pf.elements.old.value) return '要先填現在的密碼';
    if (pf.elements.pw.value.trim().length < 6) return '新密碼至少要 6 個字';
    return null;
  }, async () => {
    await auth.setPassword(pf.elements.old.value, pf.elements.pw.value);
    pf.reset();
    say(pf, '密碼改好了，下次用新的密碼登入', true);
  });
}

async function logout() {
  await auth.logout();
  close();
  passport.close();
  await refresh();
}
