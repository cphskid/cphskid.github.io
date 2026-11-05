// 後台的爸媽任務（資料庫在 supabase/park_parent.sql）：
//   「孩子在等你」：我是監護人的每個孩子，還沒做的爸媽任務一格一個按鈕（看冒險、送貼紙、訂本週目標、簽週末聯絡簿）
//   「幫孩子開帳號」：帳號直接開在家長的家庭班、自動連起來，給一張登入卡
//   孩子給的家長碼（網址 ?parent=XXXXXX）：登入或註冊後送出，孩子在樂園按「是我的爸媽」才連起來
//   孩子寄的邀請信（網址 ?invite=…）：登入後大人按確認就連起來
// 每一項做完孩子下次打開樂園就拿到禮物（伺服器判斷）。
import * as auth from './auth.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STICKERS = [['great', '好棒'], ['cheer', '加油'], ['better', '有進步'], ['careful', '好認真'], ['love', '爸媽愛你'], ['play', '一起玩']];
const GOALS = [['days3', '這週來玩 3 天'], ['stamp2', '這週拿到 2 個護照章'], ['min60', '這週玩滿 60 分鐘']];
const PENDING = 'park.parent.code';
const INVITE = 'park.parent.invite';
// 家長碼連起來之後要等孩子按「是我的爸媽」
const linkedText = (r) => (r.pending
  ? `送出了！請「${r.nickname}」打開樂園的「爸媽任務」按「是我的爸媽」，按了才會連起來（孩子確認前你還看不到他的資料）`
  : `已經和「${r.nickname}」連起來了！孩子下次打開樂園就會拿到神秘蛋`);

// 網址帶的家長碼先記起來（要先登入或註冊），登入後 redeemPending 用掉
export function rememberCode() {
  const inv = new URLSearchParams(location.search).get('invite');   // 孩子寄的邀請信（park_bind.sql）
  if (inv) {
    try { sessionStorage.setItem(INVITE, inv); } catch { /* 無痕模式 */ }
    history.replaceState(null, '', location.pathname + location.hash);
  }
  const code = new URLSearchParams(location.search).get('parent');
  if (!code) return null;
  try { sessionStorage.setItem(PENDING, code.toUpperCase()); } catch { /* 無痕模式 */ }
  history.replaceState(null, '', location.pathname + location.hash);
  return code;
}
export function setPendingCode(code) {
  try { sessionStorage.setItem(PENDING, normCode(code)); return true; } catch { return false; }
}
export function pendingCode() {
  try { return sessionStorage.getItem(PENDING) ?? sessionStorage.getItem(INVITE); } catch { return null; }
}
// 登入後：打開孩子寄來的邀請，給大人看是哪個孩子，按確認才連起來
async function openInvite(token, toast, done) {
  try { sessionStorage.removeItem(INVITE); } catch { /* 無痕模式 */ }
  const dlg = $('#dlg');
  let info;
  try { info = await auth.parent.inviteInfo(token); } catch (e) { toast(e.message, true); return; }
  if (info.used) { toast(info.mine ? `你已經和「${info.nickname}」連起來了` : '這個邀請已經用過了', !info.mine); return; }
  dlg.innerHTML = `<div class="dlg"><h3>「${esc(info.nickname)}」想和你連起來</h3>
    <p class="lead">孩子的帳號是 <b>${esc(info.login)}</b>，邀請寄到 ${esc(info.email)}。</p>
    <p>確認以後，你可以看孩子每天玩了什麼、送貼紙、出測驗卷、設定寵物島時間；孩子忘記密碼時，設新密碼的連結也會寄給你。</p>
    <p class="tip">不認識這個孩子的話，按「不是我的孩子」就好，什麼都不會發生。</p>
    <p class="msg" hidden></p>
    <div class="row end"><button type="button" class="ghost" data-no>不是我的孩子</button><button type="button" class="btn go" data-yes>確認，我是爸媽</button></div></div>`;
  $('[data-no]', dlg).onclick = () => dlg.close();
  $('[data-yes]', dlg).onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { const r = await auth.parent.inviteAccept(token); dlg.close(); toast(linkedText(r)); await done?.(); }
    catch (err) { const m = $('.msg', dlg); m.textContent = err.message; m.hidden = false; b.disabled = false; }
  };
  dlg.showModal();
}
export async function redeemPending(toast, done) {
  let inv = null;
  try { inv = sessionStorage.getItem(INVITE); } catch { /* 無痕模式 */ }
  if (inv) { openInvite(inv, toast, done); return null; }
  let code = null;
  try { code = sessionStorage.getItem(PENDING); } catch { /* 無痕模式 */ }
  if (!code) return null;
  try { sessionStorage.removeItem(PENDING); } catch { /* 無痕模式 */ }
  try {
    const r = await auth.parent.redeem(code);
    toast(linkedText(r));
    return r;
  } catch (e) { toast(e.message, true); return null; }
}

// 家長碼：6 碼（ABCDEFGHJKLMNPQRSTUVWXYZ23456789），使用者可能打小寫、空白或連字號
export const normCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 輸入家長碼的小表單（首頁最上面、登入頁共用）
function codeForm(compact = false) {
  return `<form class="code-form${compact ? ' compact' : ''}" data-codeform novalidate>
    <label><span>孩子給的家長碼</span><input name="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="例如 K7QW3M"></label>
    <button class="btn go" type="submit">和孩子連起來</button>
    <p class="msg" hidden></p></form>`;
}
function bindCodeForm(box, { toast, reload }) {
  const f = $('[data-codeform]', box);
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('.msg', f), b = $('button', f), code = normCode(f.elements.code.value);
    if (code.length !== 6) { msg.textContent = `家長碼是 6 個英文字母和數字（現在 ${code.length} 個），再對一下孩子的畫面`; msg.hidden = false; f.elements.code.focus(); return; }
    b.disabled = true; msg.hidden = true;
    try {
      const r = await auth.parent.redeem(code);
      toast(linkedText(r));
      await reload();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; b.disabled = false; }
  });
}
const STEPS = `<ol class="how">
  <li><b>孩子</b>在樂園下方功能列按 <span class="key"><img src="img/parent/letter.webp" alt="">爸媽任務</span><small>（沒看到就先按「更多」）</small></li>
  <li>再按 <span class="key">拿給爸媽看</span>，畫面出現 QR 和 6 碼家長碼</li>
  <li>用手機相機掃 QR 會自動連起來；或把 6 碼打在下面</li></ol>`;

// 「孩子在等你」面板；box 是放面板的位置。
//   家長（或已經連了孩子）：完整面板，最上面就能輸入家長碼
//   老師、管理員沒有連孩子：一行小條，展開才看到輸入欄（家長用老師帳號也找得到）
export async function renderParent(box, { toast, run, openPlay, homeOnly, refresh, reload, suggestPassword }) {
  let kids;
  try { kids = await auth.parent.kids(); } catch (e) { if (e.missing) { box.innerHTML = ''; return; } throw e; }
  const waiting = await auth.parent.waiting().catch(() => []);
  const wait = waiting.length ? `<p class="wait">${waiting.map((w) => `⏳ 等「${esc(w.nickname)}」在樂園「爸媽任務」按「是我的爸媽」`).join('<br>')}</p>` : '';
  const again = reload ?? refresh;
  if (!kids.length && !homeOnly) {
    box.innerHTML = `<details class="panel parent-mini" ${waiting.length ? 'open' : ''}><summary><img src="img/parent/letter.webp" alt="">家長要和孩子連起來？輸入孩子給的家長碼 ›</summary>
      ${wait}${STEPS}${codeForm(true)}</details>`;
    bindCodeForm(box, { toast, reload: again });
    return;
  }
  box.innerHTML = `<section class="panel parent">
    <div class="head"><h2><img class="hi" src="img/parent/letter.webp" alt="">${kids.length ? '孩子在等你' : '和孩子連起來'}</h2>
      ${kids.length ? '<span class="row"><button class="btn small ghost" data-more>＋ 再連一個孩子</button><button class="btn small go" data-child>＋ 幫孩子開帳號</button></span>' : ''}</div>
    ${wait}
    ${kids.length ? `<div class="link-more" hidden>${STEPS}${codeForm(true)}</div>
      <p class="lead">每做一項，孩子下次打開樂園就會收到禮物。什麼時候做都可以，不會過期。</p>` : `<div class="link-two">
      <div class="way"><h3><span class="n">A</span>孩子已經在玩</h3>${STEPS}${codeForm()}</div>
      <div class="way"><h3><span class="n">B</span>孩子還沒有帳號</h3><img src="img/parent/egg.webp" alt="">
        <p>幫孩子開一個帳號，會自動和你連起來，孩子第一次登入就拿到神秘蛋。</p>
        <button class="btn go" data-child>幫孩子開帳號</button></div></div>`}
    ${kids.map(kidCard).join('')}
  </section>`;
  box.querySelectorAll('[data-child]').forEach((b) => { b.onclick = () => createChild({ toast, refresh: again, suggestPassword }); });
  const more = $('[data-more]', box);
  if (more) more.onclick = () => { const m = $('.link-more', box); m.hidden = !m.hidden; if (!m.hidden) $('input', m).focus(); };
  bindCodeForm(box, { toast, reload: again });
  for (const k of kids) {
    const card = $(`[data-kid="${k.id}"]`, box);
    $('[data-look]', card).onclick = () => { auth.parent.view(k.id).catch(() => {}); openPlay(k.id); };
    $$('[data-stk]', card).forEach((b) => {
      b.onclick = () => run(b, async () => {
        await auth.parent.sticker(k.id, b.dataset.stk);
        toast(`送出「${b.title}」貼紙了`);
        await refresh();
      });
    });
    $$('[data-goal]', card).forEach((b) => {
      b.onclick = () => run(b, async () => { await auth.parent.goal(k.id, b.dataset.goal); toast('本週目標訂好了'); await refresh(); });
    });
    $('[data-adults]', card).onclick = () => adults(k, { toast, refresh: again });
    paintCircle(k, card, toast);
    const sign = $('[data-sign]', card);
    if (sign) sign.onclick = () => run(sign, async () => { await auth.parent.sign(k.id); toast('聯絡簿簽好了，孩子會收到 30 時光幣'); await refresh(); });
  }
}

function kidCard(k) {
  const w = k.week ?? {};
  const goalName = GOALS.find(([c]) => c === k.goal)?.[1];
  const places = (w.places ?? []).slice(0, 4).map(esc).join('、');
  const todo = [!k.viewed, !k.stickers, !k.goal, !k.signed].filter(Boolean).length;
  return `<article class="kid" data-kid="${esc(k.id)}">
    <header><b>${esc(k.nickname)}</b><small>帳號 ${esc(k.login)}</small><button class="linkish" data-adults>連起來的大人</button>${todo ? `<span class="chip warn">${todo} 件等你</span>` : '<span class="chip ok">這週都做完了</span>'}</header>
    <div class="row circ" data-circ hidden><button class="toggle" data-circle aria-pressed="false"><i></i>同伴圈</button><span class="tip" data-circ-tip></span></div>
    <p class="wk">這週：來玩 <b>${w.days ?? 0}</b> 天、玩了 <b>${w.minutes ?? 0}</b> 分鐘、拿到 <b>${w.stamps ?? 0}</b> 個護照章${places ? `；去了${places}` : ''}</p>
    <ol class="steps">
      <li class="${k.viewed ? 'done' : ''}"><span>看看孩子的冒險</span><small>${k.viewed ? '孩子拿到 100 時光幣了' : '看完孩子拿到 100 時光幣'}</small>
        <button class="ghost" data-look>看每天玩了什麼</button></li>
      <li class="${k.stickers ? 'done' : ''}"><span>送一張鼓勵貼紙</span><small>${k.stickers ? `已經送了 ${k.stickers} 張，想送還可以再送（一天 3 張）` : '第一張會讓孩子拿到寵物島的「親子長椅」'}</small>
        <div class="stks">${STICKERS.map(([c, n]) => `<button data-stk="${c}" title="${n}" aria-label="送「${n}」貼紙" ${k.stickers_today >= 3 ? 'disabled' : ''}><img src="img/parent/${c}.webp" alt=""><small>${n}</small></button>`).join('')}</div></li>
      <li class="${k.goal ? 'done' : ''}"><span>訂這週的目標</span><small>${goalName ? `這週目標：${goalName}。達成時孩子拿到 30 時光幣，下週一可以再訂` : '選一個，孩子達成就拿到 30 時光幣'}</small>
        ${k.goal ? '' : `<div class="goals">${GOALS.map(([c, n]) => `<button class="ghost" data-goal="${c}">${n}</button>`).join('')}</div>`}</li>
      <li class="${k.signed ? 'done' : ''}"><span>簽週末聯絡簿</span><small>${k.signed ? `這週簽好了（已經簽 ${k.signs} 次，滿 4 次送全家福相框）` : `看完上面這週的摘要就可以簽，孩子拿到 30 時光幣（已經簽 ${k.signs} 次，滿 4 次送全家福相框）`}</small>
        ${k.signed ? '' : '<button class="btn small" data-sign>簽名</button>'}</li>
    </ol>
  </article>`;
}

// 同伴圈開關（supabase/park_lounge.sql）：預設打開，家長關掉就只看得到自己家的排行和寵物島
async function paintCircle(k, card, toast) {
  const row = $('[data-circ]', card);
  const btn = $('[data-circle]', card);
  const tip = $('[data-circ-tip]', card);
  let on;
  try { on = (await auth.lounge.kid(k.id)).on; } catch { return; }   // 還沒裝 SQL 就不顯示
  const paint = () => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.lastChild.textContent = on ? '同伴圈：打開' : '同伴圈：關掉';
    tip.textContent = on
      ? `每週一和同年級約 30 個小夥伴分成一圈，一起比排行、互相參觀寵物島。只看得到暱稱和角色，沒有聊天、不能互送東西。`
      : `${k.nickname} 只看得到自己家的排行和寵物島。打開就能和同年級的小夥伴一起比排行、互訪寵物島。`;
  };
  paint();
  row.hidden = false;
  btn.onclick = async () => {
    btn.disabled = true;
    try { on = await auth.lounge.setKid(k.id, !on); paint(); toast(on ? `${k.nickname} 加入同伴圈了` : `${k.nickname} 的同伴圈關掉了`); }
    catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };
}

// 連起來的大人：解除自己、移除不認識的另一位（雙方都會收到信）
async function adults(k, { toast, refresh }) {
  const dlg = $('#dlg');
  let list;
  try { list = await auth.parent.others(k.id); } catch (e) { toast(e.message, true); return; }
  dlg.innerHTML = `<div class="dlg"><h3>和「${esc(k.nickname)}」連起來的大人</h3>
    <ul class="qt-gcls">${list.map((g) => `<li><b>${esc(g.name)}${g.mine ? '（你）' : ''}</b>
      <small>${g.status === 'pending' ? '等孩子確認' : '已連起來'}</small>
      <button type="button" class="ghost small danger" data-off="${esc(g.id)}" data-mine="${g.mine ? 1 : ''}">${g.mine ? '解除我和孩子的連結' : '移除這位大人'}</button></li>`).join('')}</ul>
    <p class="tip">解除以後就看不到孩子的資料，孩子也會離開你的家庭班。不認識的大人可以直接移除，孩子的爸媽都會收到通知信。</p>
    <div class="row end"><button type="button" class="btn" data-close>關起來</button></div></div>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  dlg.querySelectorAll('[data-off]').forEach((b) => {
    b.onclick = async () => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '確定嗎？再按一次'; return; }
      b.disabled = true;
      try {
        await auth.parent.unbind(k.id, b.dataset.mine ? null : b.dataset.off);
        dlg.close();
        toast(b.dataset.mine ? `解除了，你和 ${k.nickname} 不再連在一起` : '移除了');
        await refresh();
      } catch (err) { toast(err.message, true); b.disabled = false; }
    };
  });
  if (!dlg.open) dlg.showModal();
}

// 幫孩子開帳號：開好給一張登入卡（帳號、密碼、樂園網址的 QR）
function createChild({ toast, refresh, suggestPassword }) {
  const dlg = $('#dlg');
  const pw = suggestPassword();
  dlg.innerHTML = `<form method="dialog" class="dlg">
    <h3>幫孩子開帳號</h3>
    <p class="lead">帳號會開在你的家庭班，自動和你連起來。孩子第一次登入就會拿到神秘蛋。</p>
    <label>孩子的暱稱（遊戲裡顯示的名字）<input name="nick" maxlength="16" autocomplete="off" placeholder="例如：小安"></label>
    <label>登入帳號（英文字母、數字、底線，3–16 個字）<input name="login" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例如：anan2016"></label>
    <label>密碼（至少 6 個字，有英文也有數字）<input name="pw" value="${esc(pw)}" autocomplete="off" spellcheck="false"></label>
    <label>年級（適合的遊戲會排在前面）<select name="grade"><option value="">先不填</option>
      ${[1, 2, 3, 4, 5, 6].map((g) => `<option value="${g}">${g} 年級</option>`).join('')}</select></label>
    <p class="msg" hidden></p>
    <div class="row end"><button type="button" class="ghost" data-cancel>取消</button><button type="submit" class="btn">開帳號</button></div></form>`;
  const form = $('form', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('button[type=submit]', form), msg = $('.msg', form);
    b.disabled = true;
    try {
      const v = { nick: form.elements.nick.value.trim(), login: form.elements.login.value.trim(), pw: form.elements.pw.value.trim(),
                  grade: form.elements.grade.value ? Number(form.elements.grade.value) : null };
      const r = await auth.parent.createChild(v.login, v.pw, v.nick);
      if (v.grade) await auth.teacher.setGrade(r.student, v.grade).catch(() => toast('帳號開好了，年級沒存到，可以在「孩子」頁再設', true));
      const park = new URL('./', location.href).href;
      form.innerHTML = `<h3>${esc(r.nickname)} 的帳號開好了</h3>
        <div class="login-card"><p>樂園網址<b>${esc(park)}</b></p><p>帳號<b>${esc(r.login)}</b></p><p>密碼<b>${esc(v.pw)}</b></p></div>
        <p class="tip">截圖或抄下來給孩子。孩子打開樂園 → 按「登入」→ 輸入帳號密碼。忘記密碼可以回這裡請你重設。</p>
        <div class="row end"><button type="button" class="ghost" data-copy>複製</button><button type="button" class="btn" data-done>抄好了</button></div>`;
      // 不能用 submit：表單的 submit 會再開一次帳號（以前按「好」沒反應就是這個）
      $('[data-done]', form).onclick = () => dlg.close();
      $('[data-copy]', form).onclick = async () => {
        const t = `時空冒險樂園 ${park}\n帳號：${r.login}\n密碼：${v.pw}`;
        try { await navigator.clipboard.writeText(t); toast('複製好了'); } catch { window.prompt('手動複製', t); }
      };
      refresh();
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
    finally { if (b.isConnected) b.disabled = false; }
  });
  dlg.showModal();
  $('input', dlg)?.focus();
}
