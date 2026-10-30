// 老師後台：老師、家長、管理員共用（規劃書「後台」那一章）。
//
// 開班、決定班上開放哪些遊戲、全班在各遊戲的進度、重設學生密碼、移出班級；
// 管理員多一頁：設施狀態、老師帳號、所有班級、操作紀錄。
// 權限一律由資料庫擋（supabase/park_teacher.sql），這裡只負責畫面不出錯、錯誤講白話。
import * as auth from './auth.js';
import { headHtml } from './traveller.js';
import { renderGuide, startTour } from './teacher-guide.js';
import { renderQuiz } from './teacher-quiz.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IS_DEV = /^\/dev(\/|$)/.test(location.pathname);
const BASE = IS_DEV ? '/dev/' : '/';
const ENGLISH_URL = IS_DEV ? '/gaming_english_practice/dev/' : '/gaming_english_practice/';

const STATUS = {
  open: '開放中', trial: '試營運', construction: '施工中', maintenance: '維修中', hidden: '隱藏',
};
const ACTION = {
  create_class: '開班', reset_password: '重設密碼', set_nickname: '改暱稱',
  remove_from_class: '移出班級', set_facility: '改設施',
};
const GRADES = [1, 2, 3, 4, 5, 6];

const view = $('#view');
const toastEl = $('#toast');
const dlg = $('#dlg');

let who = { kind: 'guest' };
let park = { zones: [], facilities: [] };     // data/park.json：設施的圖示（島的徽章）與介紹
let classes = [];
let active = null;                            // 現在選的班級代碼
let facilities = [];                          // park_facility_list：設施現在的狀態
let onlyAttention = false;
let byName = false;                           // 全班總覽：預設有在玩的排前面，可切回依名字
let tab = 'classes';

if (IS_DEV) $('#env').hidden = false;

// ---------- 小工具 ----------
let tt;
function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.className = bad ? 'bad' : '';
  toastEl.hidden = false;
  clearTimeout(tt);
  tt = setTimeout(() => { toastEl.hidden = true; }, bad ? 6000 : 3200);
}
// 每個會改資料的動作都走這裡：按鈕先鎖住，錯誤講出來，不要默默失敗
async function run(btn, what) {
  if (btn) btn.disabled = true;
  try { return await what(); }
  catch (e) { toast(e.message, true); return undefined; }
  finally { if (btn?.isConnected) btn.disabled = false; }
}
function ago(t) {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 90) return '剛剛';
  if (s < 3600) return `${Math.round(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小時前`;
  if (s < 172800) return '昨天';
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(t).toLocaleDateString('zh-TW');
}
function when(t) {
  return t ? new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}
function gradeText(min, max) {
  if (!min && !max) return '';
  if (min === max) return `${min} 年級`;
  return `${min ?? 1}–${max ?? 6} 年級`;
}
function badgeOf(code) {
  const f = park.facilities.find((x) => x.code === code);
  const z = park.zones.find((x) => x.code === f?.zone);
  return z?.badge ?? 'img/badge/clocktower.webp';
}
const ico = (name, cls = 'ico') => `<img class="${cls}" src="img/admin/${name}.webp" alt="">`;
const h2 = (icon, text) => `<h2>${ico(icon, 'hi')}${text}</h2>`;
function shareLink(code) {
  return `${location.origin}${BASE}?join=${encodeURIComponent(code)}`;
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what}複製好了`); }
  catch { window.prompt(`${what}（手動複製）`, text); }
}
// 系統幫忙想一組符合規則的密碼（6 個字、有英文有數字、不是連號），老師也可以自己改
function suggestPassword() {
  const L = 'abcdefghjkmnpqrstuvwxyz', D = '23456789';
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  return pick(L) + pick(L) + pick(D) + pick(D) + pick(L) + pick(D);
}

// ---------- 對話框（重設密碼、改暱稱、移出、上限） ----------
function ask({ title, body = '', fields = [], ok = '確定', danger = false, onOk }) {
  dlg.innerHTML = `<form method="dialog" class="dlg">
    <h3>${esc(title)}</h3>${body}
    ${fields.map((f) => `<label>${esc(f.label)}<input name="${f.name}" value="${esc(f.value ?? '')}"
      ${f.type ? `type="${f.type}"` : ''} ${f.max ? `maxlength="${f.max}"` : ''} autocomplete="off" spellcheck="false"></label>`).join('')}
    <p class="msg" hidden></p>
    <div class="row end"><button type="button" class="ghost" data-cancel>取消</button>
    <button type="submit" class="btn ${danger ? 'danger' : ''}">${esc(ok)}</button></div></form>`;
  const form = $('form', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('button[type=submit]', form);
    const msg = $('.msg', form);
    b.disabled = true;
    try {
      const vals = Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value.trim()]));
      const done = await onOk(vals);
      if (done === false) return;
      if (typeof done === 'string') {          // 有結果要給老師看（例如新密碼），對話框留著
        form.innerHTML = `<h3>${esc(title)}</h3><p class="result">${done}</p><div class="row end"><button class="btn" value="ok">好</button></div>`;
        return;
      }
      dlg.close();
    } catch (err) {
      msg.textContent = err.message; msg.hidden = false;
    } finally { if (b.isConnected) b.disabled = false; }
  });
  dlg.showModal();
  $('input', dlg)?.select();
}

// ---------- 登入 ----------
function renderLogin(note = '') {
  $('#tabs').hidden = true;
  $('#hero').hidden = true;
  $('#who').hidden = true;
  $('#logout').hidden = true;
  view.innerHTML = `<section class="panel narrow">
    <div class="hello"><img src="img/admin/av-teacher.webp" alt=""><div>
    <h2>老師／家長登入</h2><p class="lead">${note || '用開班帳號的 email 登入。守護異世界的老師帳號可以直接用。'}</p></div></div>
    <form class="form" id="login" novalidate>
      <label>email<input name="email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@school.edu.tw"></label>
      <label>密碼<input name="pw" type="password" autocomplete="current-password" placeholder="至少 8 個字"></label>
      <p class="msg" hidden></p>
      <button class="btn go" type="submit">登入</button>
    </form>
    <p class="tip">還沒有開班帳號？<a href="${BASE}?staff=signup">到樂園大門建立一個</a>，不用收確認信。</p>
  </section>`;
  const f = $('#login');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('.msg', f);
    const email = f.elements.email.value.trim(), pw = f.elements.pw.value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'email 看起來不太對，再檢查一下'; msg.hidden = false; return; }
    if (pw.length < 8) { msg.textContent = `密碼至少要 8 個字（現在 ${pw.length} 個）`; msg.hidden = false; return; }
    const b = $('button', f); b.disabled = true; b.textContent = '登入中…';
    try { who = await auth.staffLogin(email, pw); await start(); }
    catch (err) { msg.textContent = err.message; msg.hidden = false; b.disabled = false; b.textContent = '登入'; }
  });
}

// ---------- 開始 ----------
async function start() {
  who = await auth.me().catch(() => ({ kind: 'guest' }));
  if (who.kind === 'student') return renderLogin('這台裝置現在登入的是學生（' + esc(who.nickname) + '）。要用老師帳號，請直接在下面登入，學生會被登出。');
  if (who.kind !== 'staff') return renderLogin();
  if (who.active === false) return renderLogin('這個帳號已經被管理員停用了。');
  who.role = await auth.staffRole();   // 註冊時選的老師／家長；舊帳號是 null，照開的班猜
  $('#who').innerHTML = `<span><b>${esc(who.display_name)}</b><small>${who.is_admin ? '管理員' : who.role === 'parent' ? '家長' : who.role === 'teacher' ? '老師' : '老師／家長'}</small></span>`;
  $('#who').hidden = false;
  paintHero();
  $('#logout').hidden = false;
  $('#tabs').hidden = false;
  $('#tab-admin').hidden = !who.is_admin;
  const want = location.hash.slice(1);
  tab = want === 'admin' && who.is_admin ? 'admin' : ['feedback', 'play', 'news', 'guide', 'quiz'].includes(want) ? want : 'classes';
  paintTabs();
  paintFeedbackDot();
  $('#help').hidden = false;
  await show();
  if (tab === 'classes') startTour();   // 第一次進來跑一次導覽，看過就不再自己跳
}
// 右上「？」：回到我的班級重看導覽
$('#help').onclick = async () => {
  if (tab !== 'classes') { tab = 'classes'; history.replaceState(null, '', '#classes'); paintTabs(); await show(); }
  startTour(true);
}
// 頁首橫幅：管理員、老師、家長（開的全是家庭班）用不同的頭像
function paintHero() {
  const home = who.role ? who.role === 'parent' : classes.length > 0 && classes.every((c) => c.kind === 'home');
  const role = who.is_admin ? 'admin' : home ? 'parent' : 'teacher';
  $('#avatar').src = `img/admin/av-${role}.webp`;
  $('#hi').textContent = `${who.display_name}，你好`;
  $('#role').textContent = who.is_admin ? '管理員・可以管理所有設施、老師與班級' : home ? '家長・幫孩子開班、看進度' : '老師・開班、開放遊戲、看全班進度';
  $('#hero').hidden = false;
}
function paintTabs() {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
}
$$('#tabs button').forEach((b) => {
  b.onclick = () => { tab = b.dataset.view; history.replaceState(null, '', '#' + tab); paintTabs(); show(); };
});
$('#logout').onclick = async () => { await auth.logout(); location.href = BASE; };

async function show() {
  view.innerHTML = '<p class="loading"><img src="img/tick/boat.webp" alt="">讀取中…</p>';
  try {
    if (tab === 'admin') await renderAdmin();
    else if (tab === 'feedback') await renderFeedback();
    else if (tab === 'play') await renderPlay();
    else if (tab === 'news') await renderNews();
    else if (tab === 'guide') renderGuide(view, { onTour: () => $('#help').click() });
    else if (tab === 'quiz') {
      if (!classes.length) classes = await auth.teacher.classes();
      if (!classes.some((c) => c.code === active)) active = classes[0]?.code ?? null;
      await renderQuiz(view, { classes, active, admin: !!who.is_admin, setActive: (c) => { active = c; }, toast });
    }
    else await renderClasses();
  } catch (e) {
    if (e.missing) return renderMissing(e.message);
    view.innerHTML = `<section class="panel"><div class="empty"><img src="img/admin/tick-error.webp" alt=""><p>${esc(e.message)}</p>
      <button class="btn" id="retry">再試一次</button></div></section>`;
    $('#retry').onclick = show;
  }
}
function renderMissing(msg) {
  view.innerHTML = `<section class="panel narrow"><div class="empty"><img src="img/admin/tick-error.webp" alt="">
    <p>${esc(msg)}</p><p class="tip">在那之前，請先用守護異世界的老師後台，登入狀態是共用的。</p>
    <a class="btn" href="${ENGLISH_URL}">打開守護異世界的老師後台</a></div></section>`;
}

// =============================================================================
// 我的班級
// =============================================================================
async function renderClasses() {
  [classes, facilities] = await Promise.all([auth.teacher.classes(), auth.teacher.facilities()]);
  if (!classes.some((c) => c.code === active)) active = classes[0]?.code ?? null;
  paintHero();
  const claim = who.has_admin === false ? `<section class="panel notice"><div class="hello"><img src="img/tick/surprised.webp" alt="">
    <div><h3>這個系統還沒有管理員</h3><p class="lead">你是第一個使用者的話，按這個按鈕成為管理員。有了管理員之後，這顆按鈕就沒有作用了。</p>
    <button class="btn" id="claim">我是第一個使用者</button></div></div></section>` : '';

  view.innerHTML = `${claim}
  <section class="panel">
    <div class="head">${h2('class', '我的班級')}<button class="btn go" id="new">＋ 開新班</button></div>
    <div id="newform" hidden></div>
    ${classes.length ? `<div class="classtabs" role="tablist">${classes.map((c) => `
      <button role="tab" data-code="${esc(c.code)}" class="${c.code === active ? 'on' : ''}">
        <b>${esc(c.name || c.code)}</b><small>${c.kind === 'home' ? '家庭班' : gradeText(c.grade, c.grade) || '學校班'}・${c.members} 人</small></button>`).join('')}</div>`
    : `<div class="empty"><img src="img/admin/tick-empty.webp" alt=""><p>還沒有班級。按「開新班」，取個班名、選年級，就會拿到一組班級代碼給小朋友註冊。</p></div>`}
  </section>
  <div id="cls"></div>`;

  $('#claim')?.addEventListener('click', (e) => run(e.currentTarget, async () => {
    await auth.claimFirstAdmin();
    who = await auth.me();
    toast('你現在是管理員了');
    await start();
  }));
  $('#new').onclick = () => toggleNewForm();
  $$('.classtabs [data-code]').forEach((b) => { b.onclick = () => { active = b.dataset.code; renderClasses(); }; });
  if (!classes.length) toggleNewForm(true);
  if (active) await renderClass();
}

function classForm(c = {}) {
  const kind = c.kind ?? (who.role === 'parent' ? 'home' : 'school');   // 家長開班預設家庭班
  return `<label>班級名稱<input name="name" maxlength="20" value="${esc(c.name ?? '')}" placeholder="例如 五年二班、小明家"></label>
    <label>類型<select name="kind">
      <option value="school" ${kind === 'school' ? 'selected' : ''}>學校班</option>
      <option value="home" ${kind === 'home' ? 'selected' : ''}>家庭班</option></select></label>
    <label>年級<select name="grade"><option value="">${kind === 'home' ? '不指定' : '請選'}</option>
      ${GRADES.map((g) => `<option value="${g}" ${c.grade === g ? 'selected' : ''}>${g} 年級</option>`).join('')}</select></label>`;
}
function readClassForm(f) {
  const name = f.elements.name.value.trim();
  const kind = f.elements.kind.value;
  const grade = f.elements.grade.value ? Number(f.elements.grade.value) : null;
  if (!name) throw new Error('填一下班級名稱');
  if (kind === 'school' && !grade) throw new Error('學校班請選年級，適合的遊戲會排在前面');
  return { name, kind, grade };
}
function toggleNewForm(force) {
  const box = $('#newform');
  const on = force ?? box.hidden;
  box.hidden = !on;
  if (!on) { box.innerHTML = ''; return; }
  box.innerHTML = `<form class="form grid" novalidate>${classForm()}
    <div class="row"><button class="btn go" type="submit">開班</button></div><p class="msg" hidden></p></form>
    <p class="tip">代碼由系統產生（不會有容易看錯的 0、O、1、I）。開好之後預設開放所有「開放中」的遊戲，可以在下面調整。</p>`;
  const f = $('form', box);
  f.elements.name.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('.msg', f);
    try {
      const v = readClassForm(f);
      const b = $('button[type=submit]', f); b.disabled = true;
      active = await auth.teacher.createClass(v.name, v.grade, v.kind);
      toast(`「${v.name}」開好了，代碼是 ${active}`);
      await renderClasses();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; $('button[type=submit]', f).disabled = false; }
  });
}

async function renderClass() {
  const c = classes.find((x) => x.code === active);
  const box = $('#cls');
  box.innerHTML = `
  <section class="panel notice" id="p-week" hidden></section>
  <section class="panel" id="p-info"></section>
  <section class="panel" id="p-fac"></section>
  <section class="panel" id="p-ov"><p class="loading"><img src="img/tick/map.webp" alt="">整理全班進度中…</p></section>`;
  paintInfo(c);
  paintFacilities(c);
  await paintOverview(c);
  paintWeek(c);
}

// ---------- 本週該看的三件事：誰好幾天沒來、誰需要注意、下一步做什麼（用全班總覽算好的資料） ----------
function paintWeek(c) {
  const p = $('#p-week');
  const ov = lastOverview;
  if (!p || !ov?.students?.length || ov.cls?.code !== c.code) return;
  const day = 86400000;
  const away = ov.students.filter((s) => !s.last || s.last < Date.now() - 3 * day);
  const att = ov.students.filter((s) => s.locked || ov.games.some((g) => g.rows[s.id]?.attention));
  const names = (list) => list.slice(0, 5).map((s) => esc(s.nickname)).join('、') + (list.length > 5 ? ` 等 ${list.length} 位` : '');
  const items = [
    away.length
      ? `<b>${away.length} 位 3 天以上沒來</b>：${names(away)}。可以在「樂園公告」寄封信鴿信提醒。`
      : '<b>全班最近 3 天都有來</b>，很棒！',
    att.length
      ? `<b>${att.length} 位需要注意</b>：${names(att)}。在下面總覽點「只看需要注意」看原因。`
      : '<b>沒有需要注意的孩子</b>，進度都正常。',
    ov.games.length
      ? '<b>看看哪裡常錯</b>：點總覽欄位上的「細節頁」，先看紅色（答對率不到 60%）的章，陪孩子對照課本。'
      : '<b>還沒開放任何島</b>：在上面「開放哪些島」勾選。',
  ];
  p.innerHTML = `<div class="hello"><img src="img/tick/map.webp" alt=""><div><h3>本週該看的三件事</h3>
    <ol class="week">${items.map((t) => `<li>${t}</li>`).join('')}</ol></div></div>`;
  p.hidden = false;
}

// ---------- 班級資料：代碼、分享連結、開放加入 ----------
function paintInfo(c) {
  const p = $('#p-info');
  p.innerHTML = `
    <div class="head">${h2('students', esc(c.name || c.code))}
      <div class="chips"><span class="chip">${c.kind === 'home' ? '家庭班' : '學校班'}</span>
      ${c.grade ? `<span class="chip">${c.grade} 年級</span>` : ''}<span class="chip">${c.members} 人</span></div></div>
    <div class="codebox">
      <div><small>班級代碼</small><span class="code">${esc(c.code)}</span></div>
      <p>小朋友第一次來，在樂園按 Start Game →「第一次來」，填這組代碼。已經有帳號的，到「我的資料」輸入代碼加入。</p>
      <div class="row">
        <button class="ghost" data-copy-code>${ico('export')}複製代碼</button>
        <button class="ghost" data-copy-link>${ico('mail')}複製分享連結</button>
      </div>
    </div>
    <div class="row">
      <button class="toggle ${c.open ? 'on' : ''}" data-open aria-pressed="${c.open}">
        <i></i>${c.open ? '開放加入中' : '已關閉加入'}</button>
      <span class="tip">${c.open ? '上課讓全班註冊完，就可以關起來，代碼流出去也沒用。' : '關起來了，沒加入過的人進不來。'}</span>
    </div>
    <div class="row" data-petq-row hidden>
      <button class="toggle" data-petq aria-pressed="false"><i></i>上課時間桌寵休息</button>
      <span class="tip" data-petq-tip></span>
    </div>
    <details><summary>${ico('edit')}修改班級資料、換代碼</summary>
      <form class="form grid" data-save novalidate>${classForm(c)}
        <div class="row"><button class="btn" type="submit">儲存</button></div><p class="msg" hidden></p></form>
      <div class="row"><button class="ghost" data-regen>換一組代碼</button>
      <span class="tip">代碼流出去了才需要換。班上的人都會跟著走，不會被踢出去。</span></div>
    </details>`;
  $('[data-copy-code]', p).onclick = () => copy(c.code, '代碼');
  $('[data-copy-link]', p).onclick = () => copy(shareLink(c.code), '分享連結');
  $('[data-open]', p).onclick = (e) => run(e.currentTarget, async () => {
    c.open = await auth.teacher.setOpen(c.code, !c.open);
    toast(c.open ? '打開了，現在可以加入' : '關起來了，新的人進不來');
    paintInfo(c);
  });
  paintPetQuiet(c, p);
  $('[data-regen]', p).onclick = (e) => {
    if (!confirm(`要把 ${c.code} 換成新的代碼嗎？舊代碼會失效，班上的人都還在。`)) return;
    run(e.currentTarget, async () => {
      active = await auth.teacher.regenerateCode(c.code);
      toast(`換成新代碼 ${active}，班上的人都還在`);
      await renderClasses();
    });
  };
  const f = $('[data-save]', p);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('.msg', f);
    try {
      const v = readClassForm(f);
      await auth.teacher.saveClass(c.code, v.name, v.grade, v.kind);
      toast('班級資料存好了');
      await renderClasses();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  });
}

// 主島桌寵：上課時間（週一到週五 8:00–16:00）讓這個班的桌寵休息。資料庫還沒裝 park_pet.sql 就不顯示。
async function paintPetQuiet(c, p) {
  const row = $('[data-petq-row]', p);
  const btn = $('[data-petq]', p);
  const tip = $('[data-petq-tip]', p);
  let on;
  try { on = await auth.pet.classQuiet(c.code); } catch { return; }
  const paint = () => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.lastChild.textContent = on ? '上課時間桌寵休息中' : '上課時間也能玩桌寵';
    tip.textContent = on ? '週一到週五 8:00–16:00，這個班的小朋友打開桌寵會看到牠在睡覺，放學後照常。'
                         : '打開後，週一到週五 8:00–16:00 桌寵會休息，小朋友上課不會分心。';
  };
  paint();
  row.hidden = false;
  btn.onclick = () => run(btn, async () => {
    on = await auth.pet.setClassQuiet(c.code, !on);
    toast(on ? '上課時間桌寵會休息' : '上課時間也能玩桌寵了');
    paint();
  });
}

// ---------- 開放哪些遊戲 ----------
function fits(f, grade) {
  if (!grade || (!f.grade_min && !f.grade_max)) return false;
  return grade >= (f.grade_min ?? 1) && grade <= (f.grade_max ?? 9);
}
function paintFacilities(c) {
  const p = $('#p-fac');
  const on = new Set(c.facilities);
  const list = facilities
    .filter((f) => f.status !== 'hidden' && f.code !== 'quiz')   // 時光試煉島不用開放，出卷就能寫
    .map((f) => ({ ...f, fit: fits(f, c.grade) }))
    .sort((a, b) => (b.fit - a.fit) || 0);
  p.innerHTML = `<div class="head">${h2('park', '開放的遊戲')}</div>
    <p class="lead">勾起來的遊戲，班上的小朋友在樂園地圖上才進得去。${c.grade ? `適合 ${c.grade} 年級的排在前面。` : ''}</p>
    <ul class="facs">${list.map((f) => {
      const trialMine = f.status === 'trial' && c.trials.includes(f.code);
      const note = f.status === 'construction' ? '還在施工，先勾起來，開幕當天班上就能玩'
        : f.status === 'maintenance' ? '正在維修，修好會自動恢復'
        : f.status === 'trial' ? (trialMine ? '你的班是試玩班，可以先玩' : '試營運中，只有管理員指定的試玩班能玩')
        : '';
      return `<li class="${on.has(f.code) ? 'on' : ''}">
        <label><input type="checkbox" data-fac="${esc(f.code)}" ${on.has(f.code) ? 'checked' : ''}>
        <img src="${esc(badgeOf(f.code))}" alt="">
        <span><b>${esc(f.name)}</b><small>${[f.subject, gradeText(f.grade_min, f.grade_max)].filter(Boolean).map(esc).join('・')}</small>
        ${note ? `<em>${esc(note)}</em>` : ''}</span>
        <span class="chips">${f.fit ? '<span class="chip fit">適合這個年級</span>' : ''}<span class="chip st-${f.status}">${STATUS[f.status]}</span></span></label></li>`;
    }).join('')}</ul>`;
  let saving = Promise.resolve();
  $$('[data-fac]', p).forEach((box) => {
    box.onchange = () => {
      const next = $$('[data-fac]', p).filter((x) => x.checked).map((x) => x.dataset.fac);
      box.closest('li').classList.toggle('on', box.checked);
      const name = facilities.find((f) => f.code === box.dataset.fac)?.name;
      saving = saving.then(async () => {
        try {
          c.facilities = await auth.teacher.setFacilities(c.code, next);
          toast(box.checked ? `「${name}」開放給這個班了` : `「${name}」對這個班關起來了`);
          paintOverview(c);
        } catch (e) {
          toast(e.message, true);
          paintFacilities(c);          // 存失敗就照資料庫的樣子顯示，不要留著假的勾勾
        }
      });
    };
  });
}

// ---------- 全班總覽 ----------
let lastOverview = null;
async function paintOverview(c) {
  const p = $('#p-ov');
  if (!p) return;
  let ov;
  // 頭像與護照章數（P4）：沒裝 park_passport.sql 就不顯示，總覽照常
  const avatarsP = auth.passport.classAvatars(c.code).catch(() => null);
  const looksP = auth.traveller.classLooks(c.code).catch(() => null);   // 頭像＝學生的時空旅人大頭
  const playsP = auth.teacher.lastPlay(c.code).catch(() => null);        // 最後在玩什麼：沒裝 park_playlog.sql 就不顯示
  const starterP = auth.starter.class(c.code).catch(() => null);        // 新手手冊翻到第幾頁：沒裝 park_starter.sql 就不顯示
  try { ov = await auth.teacher.overview(c.code); }
  catch (e) {
    p.innerHTML = `<div class="head">${h2('chart', '全班總覽')}</div><div class="empty"><img src="img/admin/tick-error.webp" alt=""><p>${esc(e.message)}</p></div>`;
    return;
  }
  const looks = new Map((await looksP ?? []).map((a) => [a.student_id, a.look]));
  const avs = new Map((await avatarsP ?? []).map((a) => [a.student_id, { ...a, look: looks.get(a.student_id) }]));
  const plays = new Map((await playsP ?? []).map((r) => [r.student_id, r]));
  const guides = new Map((await starterP ?? []).map((r) => [r.student_id, r]));
  lastOverview = { cls: c, ...ov, plays };
  const games = ov.games;
  // 最後活動：資料庫有給（park_class_last_active）就用，沒有就拿各遊戲的最後遊玩時間
  const lastOf = (s) => [s.last_active, ...games.map((g) => g.rows[s.id]?.last_played)]
    .filter(Boolean).map((t) => new Date(t).getTime()).reduce((a, b) => Math.max(a, b), 0);
  const name = (a, b) => a.nickname.localeCompare(b.nickname, 'zh-TW') || a.login_id.localeCompare(b.login_id);
  const students = ov.students.map((s) => ({ ...s, last: lastOf(s) }))
    .sort(byName ? name : (a, b) => (b.last - a.last) || name(a, b));
  const week = students.filter((s) => s.last > Date.now() - 7 * 86400000).length;
  lastOverview.students = students;
  const flagged = (s) => s.locked || games.some((g) => g.rows[s.id]?.attention);
  const nFlag = students.filter(flagged).length;
  const shown = onlyAttention ? students.filter(flagged) : students;

  if (!students.length) {
    p.innerHTML = `<div class="head">${h2('chart', '全班總覽')}</div><div class="empty"><img src="img/admin/tick-empty.webp" alt="">
      <p>還沒有人加入這個班。把代碼 <b>${esc(c.code)}</b> 或分享連結給小朋友，註冊好就會出現在這裡。</p></div>`;
    return;
  }
  const head = games.map((g) => {
    // 帶 ?teacher&class=：遊戲那邊直接開老師頁的這一班（老師自己也是學生時，不會被帶進遊戲）
    const base = IS_DEV ? g.detail_url_dev : g.detail_url;
    const url = base && `${base}${base.includes('?') ? '&' : '?'}teacher&class=${encodeURIComponent(c.code)}`;
    return `<th><div class="gh"><img src="${esc(badgeOf(g.code))}" alt=""><span><b>${esc(g.name)}</b>
      ${url ? `<a href="${esc(url)}" title="這個遊戲自己的老師頁：最常錯的字、額外開放關卡">細節頁 ›</a>` : ''}</span></div>
      ${g.error ? `<small class="warn">${esc(g.error)}</small>` : ''}</th>`;
  }).join('');
  const cell = (g, s) => {
    if (g.error) return '<td class="na">—</td>';
    const r = g.rows[s.id];
    if (!r) return '<td class="na">—</td>';
    return `<td class="${r.attention ? 'att' : ''}"><div class="prog" title="進度 ${r.progress}%">${r.progress > 0 ? `<i style="width:calc(${Math.min(100, r.progress)}% + 16px)"></i>` : ''}</div>
      <div class="pct">${r.progress}%<span>${esc(ago(r.last_played) || '還沒玩')}</span></div>
      <div class="st">${esc(r.status ?? '')}</div>${r.attention && r.reason ? `<div class="why">${ico('st-attention')}${esc(r.reason)}</div>` : ''}</td>`;
  };
  p.innerHTML = `<div class="head">${h2('chart', '全班總覽')}
      <div class="row"><button class="toggle small ${byName ? '' : 'on'}" data-sort title="打開：最近有在玩的排前面；關掉：依名字排"><i></i>有在玩的排前面</button>
      <button class="toggle small ${onlyAttention ? 'on' : ''}" data-att><i></i>只看需要注意（${nFlag}）</button>
      <button class="ghost small" data-csv>${ico('export')}匯出 CSV</button><button class="ghost small" data-reload>${ico('clock')}重新整理</button></div></div>
    <p class="lead">${students.length} 位學生，<b>最近 7 天有 ${week} 位來玩</b>${nFlag ? `，<b class="warn">${nFlag} 位需要注意</b>` : ''}。${games.length ? '每一欄是這個班有開放的遊戲。' : '這個班還沒有開放任何遊戲，在上面勾選。'}</p>
    <div class="tablewrap"><table class="ov">
      <thead><tr><th class="stu">學生</th>${head}<th class="ops">學生管理</th></tr></thead>
      <tbody>${shown.map((s) => `<tr>
        <td class="stu">${avCell(avs.get(s.id))}<b>${esc(s.nickname)}</b><small>${esc(s.login_id)}</small>
          <small class="seen ${s.last > Date.now() - 7 * 86400000 ? 'on' : ''}" title="在任何遊戲或樂園裡最後一次動作的時間">${s.last ? `最後活動 ${esc(ago(s.last))}` : '還沒玩過'}</small>
          ${plays.get(s.id) ? `<small class="now" title="最近 60 天最後玩的地方">在玩：${esc(playText(plays.get(s.id)))}</small>` : ''}
          ${guides.get(s.id) ? `<small class="now" title="新註冊的孩子前七天照新手手冊走，一天開一頁">${guides.get(s.id).finished ? '新手手冊：七頁都完成了' : `新手手冊：做完 ${guides.get(s.id).pages} / 7 頁`}</small>` : ''}
          ${s.primary ? '' : `<span class="tag" title="這個班不是他的主要班級；守護異世界的排行榜在他的主要班級">${ico('st-info')}另外加入</span>`}
          ${s.locked ? `<span class="tag bad">${ico('st-locked')}密碼鎖住了</span>` : ''}</td>
        ${games.map((g) => cell(g, s)).join('')}
        <td class="ops"><button class="ghost small" data-tl="${s.id}">${ico('clock')}遊玩紀錄</button>
          ${s.manage === false ? `<small class="tip" title="改密碼、改暱稱、換主要班級會影響他整個帳號，只有他主要班級的老師、綁定的家長或管理員可以做">密碼和暱稱由他主要班級的老師或家長管理</small>` : `
          <button class="ghost small" data-pw="${s.id}">${ico('reset-password')}重設密碼</button>
          <button class="ghost small" data-nick="${s.id}">${ico('edit')}改暱稱</button>
          ${s.primary ? '' : `<button class="ghost small" data-primary="${s.id}">${ico('class')}設成主要班級</button>`}`}
          ${s.guardian ? `<button class="ghost small" data-gcls="${s.id}">${ico('class')}孩子的所有班</button>` : ''}
          <button class="ghost small danger" data-rm="${s.id}">${ico('delete')}移出</button></td></tr>`).join('')}
      </tbody></table></div>
    ${shown.length ? '' : `<div class="empty small"><img src="img/admin/tick-done.webp" alt=""><p>目前沒有需要注意的學生。</p></div>`}`;

  $('[data-sort]', p).onclick = () => { byName = !byName; paintOverview(c); };
  $('[data-att]', p).onclick = () => { onlyAttention = !onlyAttention; paintOverview(c); };
  $('[data-reload]', p).onclick = (e) => run(e.currentTarget, () => paintOverview(c));
  $('[data-csv]', p).onclick = () => exportCsv();
  const byId = new Map(students.map((s) => [s.id, s]));
  $$('[data-tl]', p).forEach((b) => { b.onclick = () => openPlay(c.code, b.dataset.tl); });
  $$('[data-pw]', p).forEach((b) => { b.onclick = () => resetPassword(byId.get(b.dataset.pw)); });
  $$('[data-nick]', p).forEach((b) => { b.onclick = () => renameStudent(c, byId.get(b.dataset.nick)); });
  $$('[data-rm]', p).forEach((b) => { b.onclick = () => removeStudent(c, byId.get(b.dataset.rm)); });
  $$('[data-primary]', p).forEach((b) => { b.onclick = () => setPrimary(c, byId.get(b.dataset.primary)); });
  $$('[data-gcls]', p).forEach((b) => { b.onclick = () => guardianClasses(byId.get(b.dataset.gcls)); });
}

// ---------- 遊玩紀錄（park_playlog.sql） ----------
// 「島嶼開拓者・第三章 大航海時代」；守護異世界整趟那筆沒有地點，就只寫遊戲名
const playText = (r) => (r.label ? `${r.game}・${r.label}` : r.game);
function mins(sec) {
  if (sec == null) return '';
  if (sec < 60) return '不到 1 分鐘';
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} 分鐘` : `${Math.floor(m / 60)} 小時 ${m % 60} 分`;
}
const dayOf = (t) => new Date(t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
const clock = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const KIND_NOTE = { save: '舊紀錄：只知道最後存檔時間' };

// 同一分鐘拿到好幾個勳章（樂園一次補蓋）併成一行
function mergeStamps(rows) {
  const merged = [];
  for (const r of rows) {
    const prev = merged[merged.length - 1];
    if (r.kind === 'stamp' && prev?.kind === 'stamp' && prev.facility === r.facility
        && Math.abs(new Date(prev.started_at) - new Date(r.started_at)) < 60000) {
      prev.names.push(r.label.replace(/^拿到勳章/, ''));
      prev.label = prev.names.length > 3 ? `拿到 ${prev.names.length} 個勳章：${prev.names.slice(0, 3).join('')}…` : `拿到勳章${prev.names.join('')}`;
    } else merged.push(r.kind === 'stamp' ? { ...r, names: [r.label.replace(/^拿到勳章/, '')] } : r);
  }
  return merged;
}
const tlItems = (list) => list.map((r) => `<li class="k-${esc(r.kind)}">
        <time>${esc(clock(r.started_at))}${r.ended_at && r.seconds ? `–${esc(clock(r.ended_at))}` : ''}</time>
        <img src="${esc(r.facility === 'park' ? 'img/admin/park.webp' : badgeOf(r.facility))}" alt="">
        <span><b>${esc(r.game)}</b>${r.label && r.label !== r.game && !(r.kind === 'play' && r.place === 'enter') ? `・${esc(r.label)}` : ''}
          <small>${esc([mins(r.seconds), r.note, KIND_NOTE[r.kind]].filter(Boolean).join('・'))}</small></span></li>`).join('');

// =============================================================================
// 遊玩紀錄分頁：全班一週表（每格＝那天玩幾分鐘，顏色越深玩越久），點孩子看每天一列摘要，再點那天才看細節
// =============================================================================
let playDays = 7;
let playKid = null;
let playNames = { code: null, list: [] };   // 這班的名單（暱稱），換班才重讀

function openPlay(code, kid = null) {
  active = code; playKid = kid; tab = 'play';
  history.replaceState(null, '', '#play'); paintTabs(); show();
}
const minText = (sec) => (sec >= 60 ? `${Math.round(sec / 60)}` : sec > 0 ? '<1' : '');
// 顏色深淺：0 / 1~14 / 15~29 / 30~59 / 60 分鐘以上
const heat = (sec, plays) => (sec >= 3600 ? 4 : sec >= 1800 ? 3 : sec >= 900 ? 2 : sec > 0 || plays ? 1 : 0);
function dayList(n) {
  const out = [];
  const t = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}
const dayHead = (iso) => { const d = new Date(iso + 'T00:00:00'); return `<b>${d.getMonth() + 1}/${d.getDate()}</b><small>${'日一二三四五六'[d.getDay()]}</small>`; };

let allClasses = null;                      // 管理員：全站的班（遊玩紀錄分頁可以切到別人的班）
async function renderPlay() {
  if (!classes.length) classes = await auth.teacher.classes();
  if (who.is_admin && !allClasses) allClasses = await auth.admin.classes().catch(() => []);
  const others = (allClasses ?? []).filter((x) => !classes.some((c) => c.code === x.code) && x.members > 0);
  if (!classes.some((c) => c.code === active) && !others.some((c) => c.code === active)) active = classes[0]?.code ?? others[0]?.code ?? null;
  if (!active) {
    view.innerHTML = `<section class="panel"><div class="empty"><img src="img/admin/tick-empty.webp" alt=""><p>還沒有班級，先到「我的班級」開一個。</p></div></section>`;
    return;
  }
  const c = classes.find((x) => x.code === active) ?? others.find((x) => x.code === active);
  view.innerHTML = `<section class="panel play">
    <div class="head">${h2('clock', '遊玩紀錄')}
      <label class="inline">看最近 <select data-days>${[7, 14, 28].map((d) => `<option value="${d}" ${d === playDays ? 'selected' : ''}>${d} 天</option>`).join('')}</select></label></div>
    ${others.length ? `<label class="inline all-cls">管理員：看全站其他班 <select data-other><option value="">選一班…</option>
      ${others.map((x) => `<option value="${esc(x.code)}" ${x.code === active ? 'selected' : ''}>${esc(x.name || x.code)}（${esc(x.owner_name ?? '')}・${x.members} 人）</option>`).join('')}</select></label>` : ''}
    ${classes.length > 1 || (others.length && classes.length) ? `<div class="classtabs" role="tablist">${classes.map((x) => `<button role="tab" data-code="${esc(x.code)}" class="${x.code === active ? 'on' : ''}"><b>${esc(x.name || x.code)}</b><small>${x.members} 人</small></button>`).join('')}</div>` : ''}
    <div id="play-body"><p class="loading"><img src="img/tick/map.webp" alt="">整理中…</p></div></section>`;
  $('[data-days]').onchange = (e) => { playDays = Number(e.target.value); renderPlay(); };
  $('[data-other]')?.addEventListener('change', (e) => { if (e.target.value) { active = e.target.value; playKid = null; renderPlay(); } });
  $$('.play .classtabs [data-code]').forEach((b) => { b.onclick = () => { active = b.dataset.code; playKid = null; renderPlay(); }; });
  if (playNames.code !== c.code) {
    const ov = lastOverview?.cls?.code === c.code ? lastOverview : await auth.teacher.overview(c.code);
    playNames = { code: c.code, list: ov.students.map((s) => ({ id: s.id, nickname: s.nickname })) };
  }
  if (playKid) return paintKidDays(c, playNames.list.find((s) => s.id === playKid) ?? { id: playKid, nickname: '' });
  await paintClassDays(c);
}

async function paintClassDays(c) {
  const box = $('#play-body');
  let rows;
  try { rows = await auth.teacher.days(c.code, playDays); }
  catch (e) { box.innerHTML = `<div class="empty"><img src="img/admin/tick-error.webp" alt=""><p>${esc(/park_class_days|schema cache/.test(e.message) ? '遊玩紀錄分頁還沒裝到資料庫。' : e.message)}</p></div>`; return; }
  const days = dayList(playDays);
  // 學生 → 日期 → { sec, plays, stamps, games: [{facility, game, sec}] }
  const by = new Map();
  for (const r of rows) {
    const k = by.get(r.student_id) ?? new Map(); by.set(r.student_id, k);
    const d = k.get(r.day) ?? { sec: 0, plays: 0, stamps: 0, games: [] }; k.set(r.day, d);
    d.sec += r.seconds; d.plays += r.plays; d.stamps += r.stamps;
    if (r.seconds || r.plays) d.games.push(r);
  }
  const tot = (id) => [...(by.get(id)?.values() ?? [])].reduce((a, d) => a + d.sec, 0);
  const cnt = (id) => [...(by.get(id)?.values() ?? [])].filter((d) => d.sec || d.plays).length;
  const kids = [...playNames.list].sort((a, b) => tot(b.id) - tot(a.id) || cnt(b.id) - cnt(a.id) || a.nickname.localeCompare(b.nickname, 'zh-TW'));
  const came = kids.filter((k) => cnt(k.id)).length;
  const idle = kids.length - came;
  const rowOf = (k) => `<tr class="${cnt(k.id) ? '' : 'idle'}"><td><button class="linkish" data-kid="${esc(k.id)}">${esc(k.nickname)}</button></td>
        ${days.map((d) => { const x = by.get(k.id)?.get(d); if (!x || !(x.sec || x.plays)) return '<td></td>';
          const tip = x.games.map((g) => `${g.game} ${g.seconds ? mins(g.seconds) : `${g.plays} 次`}`).join('、');
          return `<td class="hx${heat(x.sec, x.plays)}" title="${esc(tip)}">${x.sec ? minText(x.sec) : '✓'}</td>`; }).join('')}
        <td class="sum">${tot(k.id) ? `${Math.max(1, Math.round(tot(k.id) / 60))} 分` : cnt(k.id) ? `${cnt(k.id)} 天` : '沒來'}</td></tr>`;
  box.innerHTML = `
    <p class="lead">最近 ${playDays} 天有 <b>${came}</b> / ${kids.length} 人來玩。每一格是那天玩了幾分鐘，顏色越深玩越久；「✓」是有玩但沒記到時間（2026-10-23 以前的紀錄）。點名字看那個孩子每天玩了什麼。</p>
    <p class="heat-legend"><span class="hx1">1–14</span><span class="hx2">15–29</span><span class="hx3">30–59</span><span class="hx4">60+ 分鐘</span></p>
    <div class="tablewrap"><table class="heat ${playDays > 14 ? 'many' : ''}">
      <thead><tr><th>暱稱</th>${days.map((d) => `<th>${dayHead(d)}</th>`).join('')}<th>合計</th></tr></thead>
      <tbody>${kids.filter((k) => cnt(k.id)).map(rowOf).join('')}</tbody>
      ${idle ? `<tbody class="idle-rows" hidden>${kids.filter((k) => !cnt(k.id)).map(rowOf).join('')}</tbody>` : ''}
    </table></div>
    ${idle ? `<p class="row"><button class="linkish" data-idle>還有 ${idle} 人這 ${playDays} 天沒來玩，點這裡列出來</button></p>` : ''}`;
  $('[data-idle]', box)?.addEventListener('click', (e) => { $('.idle-rows', box).hidden = false; e.currentTarget.remove(); });
  $$('[data-kid]', box).forEach((b) => { b.onclick = () => { playKid = b.dataset.kid; renderPlay(); }; });
}

async function paintKidDays(c, s) {
  const box = $('#play-body');
  let rows;
  try { rows = mergeStamps(await auth.teacher.activity(s.id, playDays)); }
  catch (e) { box.innerHTML = `<div class="empty"><img src="img/admin/tick-error.webp" alt=""><p>${esc(e.message)}</p></div>`; return; }
  const byDay = new Map();
  for (const r of rows) {
    const d = dayOf(r.started_at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  const play = (r) => r.kind === 'play' && r.facility !== 'park';
  const total = rows.filter(play).reduce((a, r) => a + (r.seconds ?? 0), 0);
  const summary = (list) => {
    const games = new Map();
    for (const r of list) {
      if (r.facility === 'park' || r.kind === 'stamp') continue;
      const g = games.get(r.facility) ?? { game: r.game, sec: 0, n: 0 }; games.set(r.facility, g);
      if (play(r)) g.sec += r.seconds ?? 0;
      if (r.kind !== 'play' || r.place !== 'enter') g.n += 1;
    }
    const stamps = list.filter((r) => r.kind === 'stamp').reduce((a, r) => a + (r.names?.length ?? 1), 0);
    return `${[...games].map(([f, g]) => `<span class="g"><img src="${esc(badgeOf(f))}" alt="">${esc(g.game.replace(/^穿越吧！/, ''))}<small>${esc(g.sec ? mins(g.sec) : `${g.n} 次`)}</small></span>`).join('')}
      ${stamps ? `<span class="g st">${ico('passport')}${stamps} 個勳章</span>` : ''}`;
  };
  box.innerHTML = `
    <div class="row"><button class="linkish" data-back>‹ 回全班</button></div>
    <h3 class="kid-h">${esc(s.nickname)} 最近 ${playDays} 天${total ? `<span class="tag">在遊戲裡共 ${esc(mins(total))}</span>` : ''}</h3>
    ${rows.length ? `<div class="kid-days">${[...byDay].map(([d, list]) => {
      const sec = list.filter(play).reduce((a, r) => a + (r.seconds ?? 0), 0);
      return `<details><summary><b class="d">${esc(d)}</b><span class="m">${sec ? esc(mins(sec)) : ''}</span><span class="gs">${summary(list)}</span></summary>
        <div class="tl-list"><ul>${tlItems(list)}</ul></div></details>`; }).join('')}</div>`
      : `<div class="empty small"><img src="img/admin/tick-empty.webp" alt=""><p>最近 ${playDays} 天沒有遊玩紀錄。</p></div>`}
    <p class="hint">每天一列，點開看那天的每一筆。玩多久從 2026-10-23 開始記；更早的只有守護異世界每一場的答題，和島嶼開拓者每章的最後存檔時間。</p>`;
  $('[data-back]', box).onclick = () => { playKid = null; renderPlay(); };
}

// 學生的樂園頭像（時空旅人的大頭）＋護照章數；還沒建旅人就只顯示章數
function avCell(a) {
  if (!a) return '';
  const img = a.look ? `<span class="av fr-${esc(a.frame)}">${headHtml(a.look)}</span>` : '';
  return `${img}<span class="stamps" title="樂園護照蓋了幾個章">${ico('passport')}${a.stamps}</span>`;
}

function resetPassword(s) {
  ask({
    title: `幫「${s.nickname}」重設密碼`,
    body: `<p class="lead">帳號 <b>${esc(s.login_id)}</b>。重設會順便解鎖，忘記密碼的小朋友通常已經試到被鎖住了。每次重設都會留紀錄。</p>`,
    fields: [{ name: 'pw', label: '新密碼（6 個以上英文或數字，不能是連號）', value: suggestPassword(), max: 32 }],
    ok: '重設',
    onOk: async ({ pw }) => {
      await auth.teacher.resetPassword(s.id, pw);
      paintOverview(lastOverview.cls);
      return `好了！請告訴 <b>${esc(s.nickname)}</b>：<br>帳號 <b class="big">${esc(s.login_id)}</b><br>新密碼 <b class="big">${esc(pw.toLowerCase())}</b>`;
    },
  });
}
function renameStudent(c, s) {
  ask({
    title: `幫「${s.nickname}」改暱稱`,
    body: '<p class="lead">暱稱在所有遊戲都一樣。他的主要班級裡不能跟別人重複。</p>',
    fields: [{ name: 'nick', label: '新暱稱', value: s.nickname, max: 16 }],
    ok: '改好',
    onOk: async ({ nick }) => {
      if (!nick || nick === s.nickname) return;
      const next = await auth.teacher.setNickname(s.id, nick);
      toast(`${s.nickname} 改名叫 ${next} 了`);
      paintOverview(c);
    },
  });
}
function setPrimary(c, s) {
  ask({
    title: `把 ${c.name || c.code} 設成「${s.nickname}」的主要班級？`,
    body: `<p class="lead">守護異世界的排行榜會改用這個班。他原本的主要班級${s.primary_class ? `（${esc(s.primary_class)}）` : ''}不會被移出，會變成另外加入的班。</p>`
      + '<p class="tip">這個班裡已經有人用同一個暱稱的話，要先幫他改暱稱。</p>',
    ok: '設成主要班級',
    onOk: async () => {
      await auth.teacher.setPrimary(c.code, s.id);
      toast(`${c.name || c.code} 現在是 ${s.nickname} 的主要班級`);
      paintOverview(c);
    },
  });
}
function removeStudent(c, s) {
  const body = s.primary
    ? `<p class="lead">這是他的<b>主要班級</b>。移出後，如果他還在別的班，最早加入的那班會變成主要班級；沒有的話他就暫時沒有班級。</p>`
    : '<p class="lead">他只會離開這個班，在其他班的身分不受影響。</p>';
  ask({
    title: `把「${s.nickname}」移出 ${c.name || c.code}？`,
    body: body + '<p class="tip">只是移出班級，帳號、角色和遊戲紀錄都還在，之後可以再用代碼加回來。</p>',
    ok: '移出', danger: true,
    onOk: async () => {
      await auth.teacher.removeStudent(c.code, s.id);
      toast(`${s.nickname} 移出了`);
      await renderClasses();
    },
  });
}
// 監護人看孩子加入的每一個班（包括別人開的），可以把孩子移出
async function guardianClasses(s) {
  let list;
  try { list = await auth.teacher.guardianClasses(s.id); } catch (err) { toast(err.message); return; }
  ask({
    title: `${s.nickname} 加入的班`,
    body: `<p class="lead">你是 ${esc(s.nickname)} 綁定的家長，看得到他在每一個班，也可以把他移出不認識的班。</p>
      <ul class="qt-gcls">${(list ?? []).map((g) => `<li><b>${esc(g.name || g.code)}</b>
        <small>${g.kind === 'home' ? '家庭班' : '班級'}・${g.mine ? '你開的' : `開班：${esc(g.owner || '其他老師')}`}${g.primary ? '・<span class="tag">主要班級</span>' : ''}</small>
        <button type="button" class="ghost small danger" data-gout="${esc(g.code)}">${ico('delete')}移出</button></li>`).join('') || '<li>還沒有加入任何班</li>'}</ul>
      <p class="tip">移出只是離開那個班，帳號和遊戲紀錄都還在。</p>`,
    ok: '好',
    onOk: async () => { await renderClasses(); },
  });
  $$('[data-gout]', dlg).forEach((b) => {
    b.onclick = async () => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '確定移出？'; return; }
      b.disabled = true;
      try {
        await auth.teacher.removeStudent(b.dataset.gout, s.id);
        b.closest('li').innerHTML = `<s>${esc(b.closest('li').querySelector('b').textContent)}</s> <small>已移出</small>`;
        toast(`${s.nickname} 移出了`);
      } catch (err) { toast(err.message); b.disabled = false; }
    };
  });
}
function exportCsv() {
  if (!lastOverview) return;
  const { cls, students, games } = lastOverview;
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['暱稱', '帳號', '主要班級', '最後活動', '最後在玩'];
  games.forEach((g) => head.push(`${g.name} 進度%`, `${g.name} 最後遊玩`, `${g.name} 狀態`, `${g.name} 需要注意`));
  const rows = students.map((s) => {
    const r = [s.nickname, s.login_id, s.primary ? '是' : s.primary_class ?? '', s.last ? new Date(s.last).toLocaleString('zh-TW') : '',
      lastOverview.plays?.get(s.id) ? playText(lastOverview.plays.get(s.id)) : ''];
    games.forEach((g) => {
      const x = g.rows[s.id];
      r.push(x?.progress ?? '', x?.last_played ? new Date(x.last_played).toLocaleString('zh-TW') : '', x?.status ?? '', x?.attention ? (x.reason ?? '是') : '');
    });
    return r;
  });
  const csv = '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${cls.name || cls.code}-全班總覽-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// =============================================================================
// 問題回報（P3 從守護異世界的管理員頁搬過來）
// 管理員：看全部、改分類、回覆給本人、刪除（＝隱藏，可救回）。
// 老師／家長：只看得到自己班學生的回報，唯讀（list_feedback 在伺服器過濾）。
// =============================================================================
const FB_STATUS = {
  new: '還沒看', bug: 'Bug 要修', request: '需求', unclear: '要 Chuck 決定', fixed: '修好了', dup: '重複', wontfix: '不處理',
};
const FB_KIND = { bug: '🐞 壞掉了', confusing: '❓ 看不懂', idea: '💡 想法' };
const isPending = (r) => r.status === 'new' || r.status === 'unclear';
// 哪個遊戲送的：樂園共用的回報（js/feedback.js）會帶 context.game；舊的守護異世界回報沒有這欄
const FB_GAME = { park: '樂園', guardian: '守護異世界', island_pioneer: '島嶼開拓者' };
const fbGame = (r) => (typeof r.context?.game === 'string' ? r.context.game : 'guardian');
// 同一個資料庫還有別的專案（貓閣咖啡，game＝catloft），它的回報不是樂園的，不列（伺服器也會排掉）
const fbList = async (status, hidden) => (await auth.feedback.list(status, hidden)).filter((r) => fbGame(r) !== 'catloft');
let fbFilter = '';
let fbGameFilter = '';

// 分頁上的紅點：管理員有還沒處理的回報
async function paintFeedbackDot(rows) {
  if (!who.is_admin) return;
  try {
    const all = rows ?? await fbList();
    $('#fb-dot').hidden = !all.some(isPending);
  } catch { /* 紅點而已，失敗就不亮 */ }
}

async function renderFeedback() {
  const manage = !!who.is_admin;
  const hidden = fbFilter === 'hidden';
  const status = fbFilter && fbFilter !== 'pending' && !hidden ? fbFilter : null;
  const all = await fbList(status, hidden);
  const rows = (fbFilter === 'pending' ? all.filter(isPending) : all)
    .filter((r) => !fbGameFilter || fbGame(r) === fbGameFilter);
  if (!fbFilter) paintFeedbackDot(all);
  const pending = hidden ? 0 : rows.filter(isPending).length;

  view.innerHTML = `<section class="panel">
    <div class="head">${h2('mail', `${manage ? '問題回報' : '班上的回報'}${pending ? `（${pending} 則待處理）` : ''}`)}
      <span class="fb-filters"><select id="fbf" class="auto">
        <option value="">全部</option><option value="pending">待處理</option>
        ${Object.entries(FB_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        ${manage ? '<option value="hidden">🗑 已刪除</option>' : ''}
      </select>
      <select id="fbg" class="auto"><option value="">全部遊戲</option>
        ${Object.entries(FB_GAME).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select></span></div>
    <p class="lead">${manage
      ? '學生和老師在樂園或遊戲裡按「💬 問題回報」送來的。回覆會出現在他的「我的回報」，按鈕會亮紅點。'
      : '你班上學生在樂園或遊戲裡按「💬 問題回報」送來的。處理進度由管理員更新。'}</p>
    ${rows.length ? `<div class="fb-list">${rows.slice(0, 100).map((r) => `<article class="fb" data-id="${r.id}">
      <div class="row"><b>${FB_KIND[r.kind] ?? esc(r.kind)}</b><span>${esc(r.who)}${r.class_code ? `<small class="mono">${esc(r.class_code)}</small>` : ''}</span>
        <span class="spacer"></span>
        ${manage && !hidden
          ? `<select data-status class="auto">${Object.entries(FB_STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`
          : `<span class="chip">${esc(FB_STATUS[r.status] ?? r.status)}</span>`}</div>
      <p class="fb-msg">${esc(r.message)}</p>
      ${manage && r.triage_note ? `<p class="tip">內部筆記：${esc(r.triage_note)}</p>` : ''}
      ${manage && !hidden ? `<form class="row fb-reply" data-reply><input name="reply" maxlength="300" value="${esc(r.reply ?? '')}" placeholder="回覆給本人（他看得到）">
        <button class="btn small" type="submit">${r.reply ? '改回覆' : '回覆'}</button></form>`
        : r.reply ? `<p class="fb-answer">💌 ${esc(r.reply)}</p>` : ''}
      <div class="row tip"><span>${esc(when(r.created_at))}・${esc(FB_GAME[fbGame(r)] ?? fbGame(r))}${r.screen ? '・' + esc(r.screen) : ''}${typeof r.context?.level === 'string' ? '・' + esc(r.context.level) : ''}${typeof r.context?.ver === 'string' ? '・v' + esc(r.context.ver) : ''}${typeof r.context?.view === 'string' ? '・' + esc(r.context.view) : ''}</span>
        <span class="spacer"></span>
        ${manage ? (hidden ? '<button class="ghost small" data-restore>救回</button>' : `<button class="ghost small danger" data-hide>${ico('delete')}刪除</button>`) : ''}</div>
    </article>`).join('')}</div>`
    : `<div class="empty small"><img src="img/admin/tick-empty.webp" alt=""><p>${hidden ? '沒有刪除的回報。' : '沒有回報。'}</p></div>`}
  </section>`;

  const sel = $('#fbf');
  sel.value = fbFilter;
  sel.onchange = () => { fbFilter = sel.value; show(); };
  const gsel = $('#fbg');
  gsel.value = fbGameFilter;
  gsel.onchange = () => { fbGameFilter = gsel.value; show(); };
  const reload = () => renderFeedback().catch((e) => toast(e.message, true));
  $$('article.fb').forEach((el) => {
    const id = Number(el.dataset.id);
    const st = $('[data-status]', el);
    if (st) st.onchange = () => run(st, async () => { await auth.feedback.triage(id, st.value); toast(`改成「${FB_STATUS[st.value]}」`); await reload(); });
    const form = $('[data-reply]', el);
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      run($('button', form), async () => { await auth.feedback.reply(id, form.elements.reply.value.trim()); toast('回覆送出了'); await reload(); });
    });
    const hide = $('[data-hide]', el);
    if (hide) hide.onclick = () => {
      if (!confirm('刪除這則回報？刪掉的可以在「已刪除」救回來。')) return;
      run(hide, async () => { await auth.feedback.hide(id, true); toast('刪掉了'); await reload(); });
    };
    const back = $('[data-restore]', el);
    if (back) back.onclick = () => run(back, async () => { await auth.feedback.hide(id, false); toast('救回來了'); await reload(); });
  });
}

// =============================================================================
// 樂園公告（park_news.sql）：一則公告勾要用哪幾種方式出現；老師只能寄信給自己的班
// =============================================================================
const NEWS_KINDS = [
  { id: 'board',   name: '📌 村莊布告欄',   tip: '貼在樂園村莊，村莊亮紅點', admin: true },
  { id: 'flag',    name: '🚩 島嶼布條＋紅點', tip: '掛在選的島上，孩子進去玩過就收', admin: true },
  { id: 'balloon', name: '🎈 熱氣球布條',   tip: '天上飄過一次，特別的事才用', admin: true },
  { id: 'letter',  name: '✉️ 信差來信',     tip: '信鴿送到信箱，點了才打開' },
];
const NEWS_LINKS = [['', '不用'], ['shop-month', '商店本月限定'], ['repair', '時光修理站'], ['wear', '換裝間'], ['pet', '寵物島']];
const taipeiDay = (plus = 0) => new Date(Date.now() + 8 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);

async function renderNews() {
  const admin = !!who.is_admin;
  const [rows, mine] = await Promise.all([auth.news.list(), auth.teacher.classes()]);
  classes = mine;
  if (!park.zones.length) park = await fetch('data/park.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => park);
  const zones = park.zones.filter((z) => z.status !== 'hidden' && z.code !== 'village');
  const links = [...NEWS_LINKS, ...zones.map((z) => [`zone:${z.code}`, `島：${z.name}`])];
  const kinds = NEWS_KINDS.filter((k) => admin || !k.admin);
  const kindText = (ks) => ks.map((k) => NEWS_KINDS.find((x) => x.id === k)?.name.split(' ')[0] ?? k).join('');

  view.innerHTML = `<section class="panel">
    <div class="head">${h2('notify', admin ? '發樂園公告' : '寄信給班上')}</div>
    <p class="lead">${admin
      ? '一則公告寫一次，勾要用哪幾種方式出現（可以勾好幾種）。全部只在樂園地圖出現，進遊戲不會跳；看過就收起來。'
      : '寄一封信給你班上的小朋友：他們回到樂園地圖時，信鴿會把信送到名牌下面的信箱。'}</p>
    <form class="form news-form" id="nf" novalidate>
      <fieldset class="news-kinds"><legend>出現方式</legend>
        ${kinds.map((k) => `<label class="check"><input type="checkbox" name="kind" value="${k.id}" ${admin ? '' : 'checked disabled'}>${k.name}<small>${k.tip}</small></label>`).join('')}
        ${admin ? '' : '<p class="tip">布告欄、島嶼布條、熱氣球只有管理員能用。</p>'}
      </fieldset>
      <label>標題<input name="title" maxlength="40" placeholder="${admin ? '例如 萬聖節限定開張囉！' : '例如 第 5 關提前開放囉！'}"></label>
      <label data-for="flag balloon" hidden>布條上的字（14 字內，沒填用標題）<input name="banner" maxlength="14"></label>
      <label>內文<textarea name="body" maxlength="400" rows="4" placeholder="兩三句就好，小朋友看得懂的話。"></textarea></label>
      <fieldset class="news-zones" data-for="flag" hidden><legend>布條掛在哪座島</legend>
        ${zones.map((z) => `<label class="check"><input type="checkbox" name="zone" value="${esc(z.code)}">${esc(z.name)}</label>`).join('')}</fieldset>
      <label>按鈕帶去哪<select name="link">${links.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>
      <fieldset class="news-to"><legend>給誰看</legend>
        ${admin ? '<label class="check"><input type="radio" name="to" value="all" checked>全站</label><label class="check"><input type="radio" name="to" value="class">指定班級</label>' : ''}
        <div class="news-classes" ${admin ? 'hidden' : ''}>${(classes.length ? classes : []).map((c) => `<label class="check"><input type="checkbox" name="cls" value="${esc(c.code)}" ${classes.length === 1 ? 'checked' : ''}>${esc(c.name || c.code)}</label>`).join('') || '<p class="tip">你還沒有班級。</p>'}</div>
      </fieldset>
      <div class="form grid">
        <label>開始<input type="date" name="starts" value="${taipeiDay()}"></label>
        <label>結束<input type="date" name="ends" value="${taipeiDay(14)}"></label>
        <label data-for="letter">署名<input name="sign" maxlength="20" value="${esc(who.display_name ?? '')}"></label>
      </div>
      <label class="check" data-for="letter"><input type="checkbox" name="important">重要：第一次登入自動打開一次</label>
      <div class="row"><button class="btn go" type="submit">${admin ? '發出公告' : '寄出'}</button></div><p class="msg" hidden></p>
    </form>
  </section>
  <section class="panel">
    <div class="head">${h2('mail', admin ? '發過的公告' : '寄過的信')}</div>
    ${rows.length ? `<div class="news-list">${rows.map((n) => `<article class="news-row${n.hidden ? ' gone' : ''}" data-id="${n.id}">
      <div class="row"><span class="chip">${kindText(n.kinds)}</span><b>${esc(n.title)}</b><span class="spacer"></span>
        ${n.hidden ? '<span class="chip">已撤回</span>' : `<button class="ghost small danger" data-hide>${ico('delete')}撤回</button>`}</div>
      ${n.body ? `<p>${esc(n.body)}</p>` : ''}
      <div class="row tip"><span>${esc(n.starts_on)} ～ ${esc(n.ends_on)}・${n.classes ? esc(n.classes.join('、')) : '全站'}${n.zones?.length ? '・島：' + esc(n.zones.join('、')) : ''}・${esc(n.author_name)}</span>
        <span class="spacer"></span><span>看過 ${n.seen} / ${n.reach} 人</span></div>
    </article>`).join('')}</div>` : '<div class="empty small"><img src="img/admin/tick-empty.webp" alt=""><p>還沒發過。</p></div>'}
  </section>`;

  const f = $('#nf');
  // 勾了哪幾種，就只顯示用得到的欄位
  const sync = () => {
    const on = new Set($$('input[name=kind]', f).filter((i) => i.checked).map((i) => i.value));
    $$('[data-for]', f).forEach((el) => { el.hidden = !el.dataset.for.split(' ').some((k) => on.has(k)); });
    if (admin) $('.news-classes', f).hidden = f.elements.to.value !== 'class';
  };
  f.addEventListener('change', sync);
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = $('.msg', f);
    msg.hidden = true;
    const v = {
      kinds: $$('input[name=kind]', f).filter((i) => i.checked).map((i) => i.value),
      title: f.elements.title.value.trim(), body: f.elements.body.value.trim(), banner: f.elements.banner.value.trim(),
      link: f.elements.link.value, zones: $$('input[name=zone]', f).filter((i) => i.checked).map((i) => i.value),
      classes: (!admin || f.elements.to.value === 'class') ? $$('input[name=cls]', f).filter((i) => i.checked).map((i) => i.value) : null,
      starts_on: f.elements.starts.value, ends_on: f.elements.ends.value, sign: f.elements.sign.value.trim(),
      important: f.elements.important.checked,
    };
    if (!v.kinds.length) { msg.textContent = '至少勾一種出現方式'; msg.hidden = false; return; }
    if (v.classes && !v.classes.length) { msg.textContent = '選要給哪一班'; msg.hidden = false; return; }
    run($('button[type=submit]', f), async () => {
      await auth.news.post(v);
      toast(admin ? '公告發出去了' : '信寄出去了，小朋友回到樂園地圖就會收到');
      await renderNews();
    });
  });
  $$('.news-row').forEach((el) => {
    const b = $('[data-hide]', el);
    if (b) b.onclick = () => {
      if (!confirm('撤回這則公告？小朋友那邊會馬上消失（看過的信也會從信箱拿掉）。')) return;
      run(b, async () => { await auth.news.hide(Number(el.dataset.id)); toast('撤回了'); await renderNews(); });
    };
  });
}

// =============================================================================
// 管理員
// =============================================================================
// ---------- 管理員：全站動態（park_admin_activity） ----------
let actDays = 7;
// ---------- 管理員：要改善的地方（park_admin_insights）：大家卡在哪、玩多久、常錯什麼 ----------
const ISLAND_ORDER = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'end', 'village', 'town', 'sky', 'isles', 'post'];
const NOW_SLOTS = ['village', 'town', 'sky', 'isles', 'post'];   // 現在篇：沒有「過關」
const SKILL_ZH = { recognize: '認字', spell: '拼字', listen: '聽音' };
// 紅黃綠：80% 以上綠、60~79% 黃、不到 60% 紅
const pctPill = (a, b) => { if (!b) return '<span class="pill none">—</span>'; const v = Math.round(100 * a / b);
  return `<span class="pill ${v >= 80 ? 'good' : v >= 60 ? 'mid' : 'bad'}">${v}%</span>`; };
let insDays = 14;
async function paintInsights(days = insDays) {
  const p = $('#p-ins');
  if (!p) return;
  insDays = days;
  const head = `<div class="head">${h2('search', '要改善的地方')}
    <div class="row">${[14, 30, 90].map((d) => `<button class="toggle small ${d === days ? 'on' : ''}" data-ins-days="${d}"><i></i>最近 ${d} 天</button>`).join('')}</div></div>`;
  let a;
  try { a = await auth.admin.insights(days); }
  catch (e) {
    p.innerHTML = `${head}<div class="empty small"><img src="img/admin/tick-error.webp" alt=""><p>${esc(/park_admin_insights|schema cache/.test(e.message) ? '分析還沒裝到資料庫。' : e.message)}</p></div>`;
    return;
  }
  const h = a.habit ?? { one: 0, few: 0, many: 0, trips: [] };
  const island = [...a.island].sort((x, y) => ISLAND_ORDER.indexOf(x.slot) - ISLAND_ORDER.indexOf(y.slot));
  const stuckTxt = (o) => Object.entries(o ?? {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k === '0' ? '剛開始' : `第 ${k} 步`} ${n} 人`).join('、');
  const stopped = [...a.guardian].filter((g) => g.stopped > 0).sort((x, y) => y.stopped - x.stopped).slice(0, 8);
  const chs = [...new Set(a.guardian.map((g) => g.chapter))];
  p.innerHTML = `${head}
    <p class="lead">「過關率」看的是全部時間；「答對率」「常錯的字」「回來玩」看最近 ${a.days} 天。紅色＝不到 60%，先看紅的。</p>
    <details class="fold" open><summary><h3>大家會不會回來玩</h3></summary>
      <div class="kpis">
        <div class="kpi"><b>${h.one}</b><span>人只來 1 天</span></div>
        <div class="kpi"><b>${h.few}</b><span>人來 2～3 天</span></div>
        <div class="kpi"><b>${h.many}</b><span>人來 4 天以上</span></div>
      </div>
      ${h.trips.length ? `<p class="tip">進一次待多久（中位數）：${h.trips.map((t) => `${esc(t.game.replace(/^穿越吧！/, ''))} ${t.median} 分鐘（${t.trips} 趟）`).join('、')}。太短可能是一進去就不知道要做什麼。</p>` : ''}
    </details>
    <details class="fold" open><summary><h3>島嶼開拓者：每一章卡在哪</h3></summary>
      <div class="tablewrap"><table class="adm">
        <thead><tr><th>章節／地點</th><th class="num">開始</th><th class="num">過關</th><th>過關率</th><th>沒過的人停在</th><th class="num">平均失誤</th></tr></thead>
        <tbody>${island.map((r) => `<tr><td><b>${esc(r.label)}</b></td><td class="num">${r.started}</td><td class="num">${r.done}</td>
          ${NOW_SLOTS.includes(r.slot) ? '<td>—</td><td>—</td>' : `<td>${pctPill(r.done, r.started)}</td><td>${esc(stuckTxt(r.stuck)) || '—'}</td>`}<td class="num">${r.mistakes ?? '—'}</td></tr>`).join('') || '<tr><td colspan="6">還沒有人玩</td></tr>'}</tbody></table></div>
      <p class="tip">現在篇（漁村、小鎮…）沒有「過關」，看開始人數就好。</p>
    </details>
    ${a.animal?.length ? `<details class="fold" open><summary><h3>時光動物祕境：每一關卡在哪</h3></summary>
      <div class="tablewrap"><table class="adm">
        <thead><tr><th>關卡</th><th class="num">開始</th><th class="num">過關</th><th>過關率</th><th>沒過的人停在</th><th class="num">平均失誤</th><th class="num">過關要多久</th></tr></thead>
        <tbody>${a.animal.map((r) => `<tr><td><b>${esc(r.label)}</b></td><td class="num">${r.started}</td><td class="num">${r.done}</td><td>${pctPill(r.done, r.started)}</td>
          <td>${esc(stuckTxt(r.stuck)) || '—'}${r.steps ? `<small class="sub">共 ${r.steps} 步</small>` : ''}</td><td class="num">${r.misses ?? '—'}</td>
          <td class="num">${r.sec ? `${Math.round(r.sec / 60)} 分鐘` : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="tip">每一步是什麼，在老師細節頁（時光動物祕境的「細節頁 ›」）的「每一關：大家卡在哪」。過關要多久是中位數。</p>
    </details>` : ''}
    <details class="fold"><summary><h3>守護異世界：大家停在哪一關</h3>${stopped.length ? `<small>最多人停住：${esc(stopped[0].name)}（${stopped[0].stopped} 人）</small>` : ''}</summary>
      ${stopped.length ? `<p class="tip">「停住」＝打到這關就沒有再往後、也還沒過。人多的關可能太難。</p>
      <div class="tablewrap"><table class="adm"><thead><tr><th>關卡</th><th class="num">停住</th><th class="num">打過</th><th class="num">過關</th><th>最近答對率</th></tr></thead>
        <tbody>${stopped.map((g) => `<tr><td><b>第${'一二三'[g.chapter - 1]}章 ${g.no}. ${esc(g.name)}</b></td><td class="num">${g.stopped}</td><td class="num">${g.played}</td><td class="num">${g.cleared}</td><td>${pctPill(g.ok, g.n)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="tip">還沒有人停在半路。</p>'}
      ${chs.map((c) => `<details class="fold sub"><summary>第${'一二三'[c - 1]}章每一關</summary><div class="tablewrap"><table class="adm">
        <thead><tr><th>關卡</th><th class="num">打過</th><th class="num">過關</th><th class="num">停住</th><th>最近答對率</th></tr></thead>
        <tbody>${a.guardian.filter((g) => g.chapter === c).map((g) => `<tr><td>${g.no}. ${esc(g.name)}</td><td class="num">${g.played}</td><td class="num">${g.cleared}</td><td class="num">${g.stopped || ''}</td><td>${pctPill(g.ok, g.n)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}
    </details>
    <details class="fold"><summary><h3>守護異世界：全站最常錯的字</h3></summary>
      <div class="tablewrap"><table class="adm"><thead><tr><th>字</th><th>題型</th><th class="num">錯幾次</th><th class="num">幾個人錯</th><th>答對率</th></tr></thead>
        <tbody>${a.words.map((w) => `<tr><td><b>${esc(w.word)}</b><small class="sub">${esc(w.zh)}</small></td><td>${esc(SKILL_ZH[w.skill] ?? w.skill)}</td><td class="num">${w.bad}</td><td class="num">${w.kids}</td><td>${pctPill(w.n - w.bad, w.n)}</td></tr>`).join('') || '<tr><td colspan="5">還沒有人答錯</td></tr>'}</tbody></table></div>
    </details>`;
  $$('[data-ins-days]', p).forEach((b) => { b.onclick = () => paintInsights(Number(b.dataset.insDays)); });
}

async function paintActivity(days) {
  const p = $('#p-act');
  if (!p) return;
  actDays = days;
  const head = `<div class="head">${h2('chart', '全站動態')}
    <div class="row">${[7, 30].map((d) => `<button class="toggle small ${d === days ? 'on' : ''}" data-act-days="${d}"><i></i>最近 ${d} 天</button>`).join('')}
    <button class="ghost small" data-act-reload>${ico('clock')}重新整理</button></div></div>`;
  let a;
  try { a = await auth.admin.activity(days); }
  catch (e) {
    p.innerHTML = `${head}<div class="empty small"><img src="img/admin/tick-error.webp" alt=""><p>${esc(/park_admin_activity|schema cache/.test(e.message) ? '遊玩紀錄還沒裝到資料庫（park_playlog.sql）。' : e.message)}</p></div>`;
    wireAct(p);
    return;
  }
  const today = a.daily[a.daily.length - 1]?.players ?? 0;
  const peak = Math.max(1, ...a.daily.map((d) => d.players));
  const dayLabel = (d) => { const t = new Date(d + 'T00:00:00'); return `${t.getMonth() + 1}/${t.getDate()}`; };
  p.innerHTML = `${head}
    <div class="kpis">
      <div class="kpi"><b>${today}</b><span>今天來玩</span></div>
      <div class="kpi"><b>${a.players}</b><span>最近 ${a.days} 天來玩</span></div>
      <div class="kpi"><b>${a.total_students}</b><span>全部學生帳號</span></div>
    </div>
    <figure class="days" aria-label="每天來玩的人數">
      ${a.daily.map((d) => `<div class="day" title="${esc(dayLabel(d.day))}：${d.players} 人">
        <span class="n">${d.players || ''}</span><i style="height:${Math.round(100 * d.players / peak)}%"></i><small>${esc(dayLabel(d.day))}</small></div>`).join('')}
    </figure>
    <div class="act-grid">
      <div><h3>各遊戲</h3><div class="tablewrap"><table class="adm">
        <thead><tr><th>遊戲</th><th class="num">人數</th><th class="num">進來幾趟</th><th class="num">共玩幾分鐘</th></tr></thead>
        <tbody>${a.games.map((g) => `<tr><td><b>${esc(g.game)}</b>${g.levels ? `<small class="sub">打了 ${g.levels} 場關卡</small>` : ''}</td>
          <td class="num">${g.players}</td><td class="num">${g.visits || '—'}</td><td class="num">${g.visits ? g.minutes : '—'}</td></tr>`).join('') || '<tr><td colspan="4">還沒有人玩</td></tr>'}</tbody></table></div></div>
      <div><h3>最多人玩的地方</h3><div class="tablewrap"><table class="adm">
        <thead><tr><th>地方</th><th class="num">人數</th><th class="num">次數</th></tr></thead>
        <tbody>${a.top.map((t) => `<tr><td><b>${esc(t.label)}</b><small class="sub">${esc(t.game)}</small></td><td class="num">${t.players}</td><td class="num">${t.times}</td></tr>`).join('') || '<tr><td colspan="3">還沒有人玩</td></tr>'}</tbody></table></div></div>
    </div>
    <details class="fold"><summary><h3>最近動態（${a.recent.length} 筆）</h3></summary>
    <div class="tablewrap"><table class="adm">
      <thead><tr><th>時間</th><th>誰</th><th>玩什麼</th><th>多久</th></tr></thead>
      <tbody>${a.recent.map((r) => `<tr><td class="nowrap">${esc(when(r.started_at))}</td>
        <td><b>${esc(r.nickname)}</b><small class="sub">${esc(r.login_id)}${r.class_code ? `・${esc(r.class_code)}` : ''}</small></td>
        <td>${esc(r.game)}${r.label && r.label !== r.game ? `・${esc(r.label)}` : ''}${r.note || r.kind === 'save' ? `<small class="sub">${esc([r.note, KIND_NOTE[r.kind]].filter(Boolean).join('・'))}</small>` : ''}</td>
        <td class="nowrap">${esc(mins(r.seconds)) || '—'}</td></tr>`).join('') || '<tr><td colspan="4">還沒有動態</td></tr>'}</tbody></table></div></details>
    <p class="hint">「進來幾趟」「共玩幾分鐘」從 ${esc(a.log_since ? new Date(a.log_since).toLocaleDateString('zh-TW') : '遊玩紀錄上線那天')} 開始記錄；更早的只看得到守護異世界每一場的答題和島嶼開拓者每章的最後存檔。</p>`;
  wireAct(p);
}
function wireAct(p) {
  $$('[data-act-days]', p).forEach((b) => { b.onclick = () => paintActivity(Number(b.dataset.actDays)); });
  const r = $('[data-act-reload]', p);
  if (r) r.onclick = (e) => run(e.currentTarget, () => paintActivity(actDays));
}

async function renderAdmin() {
  const [facs, teachers, all, log, words, flagged] = await Promise.all([
    auth.admin.facilities(), auth.admin.teachers(), auth.admin.classes(), auth.admin.audit(80),
    auth.admin.bannedWords(), auth.admin.flaggedNicknames(),
  ]);
  const activeT = teachers.filter((t) => t.active);
  const fresh = (t) => t.self_signup && Date.now() - new Date(t.created_at).getTime() < 7 * 86400e3;
  const gradeOpts = (v) => `<option value="">—</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => `<option ${v === g ? 'selected' : ''}>${g}</option>`).join('')}`;

  view.innerHTML = `
  <section class="panel" id="p-act"><div class="head">${h2('chart', '全站動態')}</div><p class="lead">讀取中…</p></section>
  <section class="panel" id="p-ins"><div class="head">${h2('search', '要改善的地方')}</div><p class="lead">讀取中…</p></section>
  <section class="panel">
    <div class="head">${h2('settings', '設施管理')}</div>
    <p class="lead">遊戲出問題時改成「維修中」，學生馬上進不去，地圖上也會掛告示，不用重新部署。試營運只有下面填的試玩班能玩。年級只是建議，不會擋人。</p>
    <div class="tablewrap"><table class="adm">
      <thead><tr><th>設施</th><th>狀態</th><th>適合年級</th><th>試玩班（代碼，逗號分開）</th><th>開放的班</th><th></th></tr></thead>
      <tbody>${facs.map((f) => `<tr data-fac="${esc(f.code)}">
        <td><div class="gh"><img src="${esc(badgeOf(f.code))}" alt=""><span><b>${esc(f.name)}</b><small>${esc(f.zone_name)}${f.summary_fn ? '' : '・還沒有全班摘要'}</small></span></div></td>
        <td><select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="nowrap"><select name="gmin">${gradeOpts(f.grade_min)}</select> 到 <select name="gmax">${gradeOpts(f.grade_max)}</select></td>
        <td><input name="trials" value="${esc(f.trials.join(', '))}" placeholder="例如 AB12CD"></td>
        <td class="num">${f.classes}</td>
        <td><button class="btn small" data-save>儲存</button></td></tr>`).join('')}</tbody></table></div>
    <p class="tip">新增設施要配合地圖的島圖，目前請告訴 Claude 幫你加。</p>
  </section>

  <section class="panel">
    <div class="head">${h2('students', `開班帳號（${teachers.length}）`)}</div>
    <p class="lead">老師和家長自己註冊的，7 天內標「新」。看起來不對（例如小朋友自己開的）就停用，停用之後開不了班也看不到班上資料。</p>
    <div class="tablewrap"><table class="adm">
      <thead><tr><th>稱呼</th><th>email</th><th>班／學生</th><th>上限</th><th>狀態</th><th></th></tr></thead>
      <tbody>${teachers.map((t) => `<tr data-t="${t.user_id}">
        <td><b>${esc(t.display_name)}</b>${fresh(t) ? `<span class="tag">${ico('st-new')}新</span>` : ''}${t.is_admin ? '<span class="tag gold">管理員</span>' : ''}</td>
        <td class="mono">${esc(t.email ?? '')}</td>
        <td class="num">${t.classes} 班・${t.students} 人</td>
        <td class="num">${t.is_admin ? '不限' : `${t.max_classes} 班・每班 ${t.max_students} 人`}</td>
        <td>${t.active ? '啟用中' : '<span class="tag bad">已停用</span>'}</td>
        <td class="nowrap">${t.is_admin ? '' : `<button class="ghost small" data-limit>上限</button>
          <button class="ghost small ${t.active ? 'danger' : ''}" data-active>${t.active ? '停用' : '恢復'}</button>`}</td></tr>`).join('')}</tbody></table></div>
    <details><summary>${ico('add-student')}幫人開帳號</summary>
      <p class="tip">老師和家長通常自己在樂園註冊就好。真的要幫人開，帳號直接開好，把 email 和密碼給他就能登入。已經自己註冊過的，填一樣的 email 會把他設成老師，密碼還是他原本那組。</p>
      <form class="form grid" id="mk" novalidate>
        <label>稱呼<input name="name" maxlength="16" placeholder="例如 王老師"></label>
        <label>email<input name="email" type="email" autocapitalize="off" spellcheck="false" placeholder="teacher@school.edu.tw"></label>
        <label>密碼<input name="pw" placeholder="至少 8 個字"></label>
        <div class="row"><button class="btn" type="submit">開帳號</button></div><p class="msg" hidden></p></form>
    </details>
  </section>

  <section class="panel">
    <div class="head">${h2('class', `全部班級（${all.length}）`)}</div>
    <p class="lead">換老師只是換帶這一班的人，班級代碼、學生、進度都不動。人數含另外加入的學生。</p>
    <div class="tablewrap"><table class="adm">
      <thead><tr><th>班級</th><th>年級／類型</th><th>人數</th><th>加入</th><th>開班人</th></tr></thead>
      <tbody>${all.map((c) => `<tr>
        <td><b>${esc(c.name || '（沒有名字）')}</b><small class="mono">${esc(c.code)}</small></td>
        <td>${c.kind === 'home' ? '家庭班' : '學校班'}${c.grade ? `・${c.grade} 年級` : ''}</td>
        <td class="num">${c.members}</td>
        <td>${c.open ? '開放' : '關閉'}</td>
        <td><select data-owner="${esc(c.code)}" ${activeT.length < 2 ? 'disabled' : ''}>
          ${activeT.map((t) => `<option value="${t.user_id}" ${t.user_id === c.owner ? 'selected' : ''}>${esc(t.display_name)}</option>`).join('')}
          ${activeT.some((t) => t.user_id === c.owner) ? '' : `<option value="${c.owner}" selected>${esc(c.owner_name ?? '')}（已停用）</option>`}
        </select></td></tr>`).join('')}</tbody></table></div>
  </section>

  <section class="panel">
    <div class="head">${h2('calendar', '操作紀錄')}</div>
    <p class="lead">重設密碼、改暱稱、移出班級、開班、改設施，誰在什麼時候做的。最近 80 筆。</p>
    ${log.length ? `<div class="tablewrap"><table class="adm log">
      <thead><tr><th>時間</th><th>誰</th><th>做了什麼</th><th>對象</th></tr></thead>
      <tbody>${log.map((a) => `<tr><td class="nowrap">${esc(when(a.at))}</td><td>${esc(a.actor_name)}</td>
        <td>${esc(ACTION[a.action] ?? a.action)}${a.action === 'set_facility' && a.detail?.to ? `：${esc(STATUS[a.detail.from] ?? '')} → ${esc(STATUS[a.detail.to] ?? '')}` : ''}</td>
        <td>${esc(a.target ?? '')}${a.class_code ? `<small class="mono">${esc(a.class_code)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty small"><img src="img/admin/tick-empty.webp" alt=""><p>還沒有紀錄。</p></div>'}
  </section>

  <section class="panel" id="banned">
    <div class="head">${h2('st-attention', `暱稱禁用字（${words.length}）`)}</div>
    <p class="lead">學生註冊和改暱稱時會擋掉含這些字的名字，空白、符號、全形、大小寫都繞不過去。勾「整個名字才擋」的字只擋剛好叫這個名字的人，給 ass 這種短字用，不然 class 也會被擋。暱稱全站共用，所以這份清單管的是樂園裡所有遊戲。</p>
    ${flagged.length ? `<p class="lead"><b>這些人的暱稱現在會被擋，幫他們換一個：</b></p>
    <div class="tablewrap"><table class="adm">
      <thead><tr><th>暱稱</th><th>主要班級</th><th></th></tr></thead>
      <tbody>${flagged.map((f) => `<tr data-flag="${esc(f.student_id)}" data-nick="${esc(f.nickname)}">
        <td><b>${esc(f.nickname)}</b></td>
        <td>${esc(f.class_name || f.class_code || '沒有班級')}${f.class_code ? `<small class="mono">${esc(f.class_code)}</small>` : ''}</td>
        <td><button class="ghost small" data-rename>${ico('edit')}改暱稱</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    <form class="form grid" id="bw" novalidate>
      <label>要擋的字<input name="word" maxlength="30" autocomplete="off" spellcheck="false"></label>
      <label class="check"><span><input type="checkbox" name="whole"> 整個名字才擋</span></label>
      <div class="row"><button class="btn small" type="submit">加入</button></div>
    </form>
    <details><summary>看清單（點字可以刪掉）</summary>
      <div class="chips words">${words.map((w) => `<button class="chip" data-word="${esc(w.word)}" title="點一下刪掉">${esc(w.word)}${w.whole ? '（整個）' : ''} ✕</button>`).join('') || '<span class="tip">清單是空的。</span>'}</div>
    </details>
  </section>`;
  paintActivity(actDays);
  paintInsights();

  // 暱稱禁用字
  $$('tr[data-flag]').forEach((tr) => {
    $('[data-rename]', tr).onclick = () => ask({
      title: `幫「${tr.dataset.nick}」換一個暱稱`,
      fields: [{ name: 'nick', label: '新暱稱', max: 12 }],
      ok: '改好',
      onOk: async ({ nick }) => {
        if (!nick) return false;
        const next = await auth.teacher.setNickname(tr.dataset.flag, nick);
        toast(`${tr.dataset.nick} 改名叫 ${next} 了`);
        await renderAdmin();
      },
    });
  });
  $('#bw').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const word = f.elements.word.value.trim();
    if (!word) return;
    run($('button', f), async () => {
      const saved = await auth.admin.addBannedWord(word, f.elements.whole.checked);
      toast(`加進去了：${saved}`);
      await renderAdmin();
      $('#banned')?.scrollIntoView({ block: 'start' });
    });
  });
  $$('[data-word]').forEach((b) => {
    b.onclick = () => {
      if (!confirm(`把「${b.dataset.word}」從禁用字拿掉？`)) return;
      run(b, async () => {
        await auth.admin.removeBannedWord(b.dataset.word);
        toast(`拿掉了：${b.dataset.word}`);
        await renderAdmin();
        $('#banned')?.scrollIntoView({ block: 'start' });
      });
    };
  });

  // 設施
  $$('tr[data-fac]').forEach((tr) => {
    $('[data-save]', tr).onclick = (e) => run(e.currentTarget, async () => {
      const g = (n) => (tr.querySelector(`[name=${n}]`).value ? Number(tr.querySelector(`[name=${n}]`).value) : null);
      const trials = tr.querySelector('[name=trials]').value.split(/[,，\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      const status = tr.querySelector('[name=status]').value;
      await auth.admin.setFacility(tr.dataset.fac, status, g('gmin'), g('gmax'), trials);
      toast(`存好了，現在是「${STATUS[status]}」`);
      await renderAdmin();
    });
  });
  // 老師
  const byT = new Map(teachers.map((t) => [t.user_id, t]));
  $$('tr[data-t]').forEach((tr) => {
    const t = byT.get(tr.dataset.t);
    $('[data-limit]', tr)?.addEventListener('click', () => ask({
      title: `${t.display_name} 的上限`,
      fields: [{ name: 'c', label: '最多幾個班（1–50）', value: t.max_classes, type: 'number' },
               { name: 's', label: '每班最多幾個人（1–200）', value: t.max_students, type: 'number' }],
      ok: '儲存',
      onOk: async ({ c, s }) => {
        await auth.admin.setLimits(t.user_id, Number(c), Number(s));
        toast(`${t.display_name} 改成最多 ${c} 個班、每班 ${s} 人`);
        await renderAdmin();
      },
    }));
    $('[data-active]', tr)?.addEventListener('click', (e) => {
      if (t.active && !confirm(`停用 ${t.display_name}？停用後他開不了班，也看不到班上資料。`)) return;
      run(e.currentTarget, async () => {
        await auth.admin.setActive(t.user_id, !t.active);
        toast(t.active ? `${t.display_name} 已停用` : `${t.display_name} 已恢復`);
        await renderAdmin();
      });
    });
  });
  // 開帳號
  const mk = $('#mk');
  mk.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('.msg', mk);
    const v = (n) => mk.elements[n].value.trim();
    if (!v('name')) { msg.textContent = '填一下他的稱呼'; msg.hidden = false; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) { msg.textContent = 'email 看起來不太對'; msg.hidden = false; return; }
    if (mk.elements.pw.value.length < 8) { msg.textContent = '老師的密碼至少要 8 個字'; msg.hidden = false; return; }
    await run($('button', mk), async () => {
      const r = await auth.admin.createTeacher(v('email'), mk.elements.pw.value, v('name'));
      toast(r.created ? `${r.email} 的帳號開好了，把 email 和密碼給他` : `${r.email} 本來就有帳號，已經設成老師，請他用原本的密碼登入`);
      await renderAdmin();
    });
  });
  // 換開班人
  $$('[data-owner]').forEach((sel) => {
    sel.onchange = () => run(sel, async () => {
      const t = byT.get(sel.value);
      await auth.admin.setClassOwner(sel.dataset.owner, sel.value);
      toast(`${sel.dataset.owner} 交給 ${t?.display_name ?? ''} 了`);
      await renderAdmin();
    });
  });
}

// ---------- 開始 ----------
try { park = await fetch('data/park.json', { cache: 'no-cache' }).then((r) => r.json()); } catch { /* 沒有圖示也能用 */ }
if (!auth.db) {
  view.innerHTML = '<section class="panel narrow"><div class="empty"><img src="img/admin/tick-error.webp" alt=""><p>帳號功能載入失敗，請重新整理再試一次。</p></div></section>';
} else {
  start();
}
