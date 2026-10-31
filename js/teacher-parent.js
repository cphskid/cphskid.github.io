// 後台的爸媽任務（資料庫在 supabase/park_parent.sql）：
//   「孩子在等你」：我是監護人的每個孩子，還沒做的爸媽任務一格一個按鈕（看冒險、送貼紙、訂本週目標、簽週末聯絡簿）
//   「幫孩子開帳號」：帳號直接開在家長的家庭班、自動連起來，給一張登入卡
//   孩子給的家長碼（網址 ?parent=XXXXXX）：登入或註冊後自動連起來
// 每一項做完孩子下次打開樂園就拿到禮物（伺服器判斷）。
import * as auth from './auth.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STICKERS = [['great', '好棒'], ['cheer', '加油'], ['better', '有進步'], ['careful', '好認真'], ['love', '爸媽愛你'], ['play', '一起玩']];
const GOALS = [['days3', '這週來玩 3 天'], ['stamp2', '這週拿到 2 個護照章'], ['min60', '這週玩滿 60 分鐘']];
const PENDING = 'park.parent.code';

// 網址帶的家長碼先記起來（要先登入或註冊），登入後 redeemPending 用掉
export function rememberCode() {
  const code = new URLSearchParams(location.search).get('parent');
  if (!code) return null;
  try { sessionStorage.setItem(PENDING, code.toUpperCase()); } catch { /* 無痕模式 */ }
  history.replaceState(null, '', location.pathname + location.hash);
  return code;
}
export function pendingCode() {
  try { return sessionStorage.getItem(PENDING); } catch { return null; }
}
export async function redeemPending(toast) {
  const code = pendingCode();
  if (!code) return null;
  try { sessionStorage.removeItem(PENDING); } catch { /* 無痕模式 */ }
  try {
    const r = await auth.parent.redeem(code);
    toast(`已經和「${r.nickname}」連起來了！孩子下次打開樂園就會拿到神秘蛋`);
    return r;
  } catch (e) { toast(e.message, true); return null; }
}

// 「孩子在等你」面板；box 是放面板的位置。沒有孩子也沒有家庭班的老師不顯示
export async function renderParent(box, { toast, run, openPlay, homeOnly, refresh, reload, suggestPassword }) {
  let kids;
  try { kids = await auth.parent.kids(); } catch (e) { if (e.missing) { box.innerHTML = ''; return; } throw e; }
  if (!kids.length && !homeOnly) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="panel parent">
    <div class="head"><h2><img class="hi" src="img/parent/letter.webp" alt="">${kids.length ? '孩子在等你' : '爸媽任務'}</h2>
      <button class="btn small go" data-child>＋ 幫孩子開帳號</button></div>
    ${kids.length ? '<p class="lead">每做一項，孩子下次打開樂園就會收到禮物。什麼時候做都可以，不會過期。</p>' : `<div class="empty-kid">
      <img src="img/parent/egg.webp" alt=""><p><b>還沒有和孩子連起來</b>孩子已經在玩的話，請孩子在樂園按功能列的「爸媽任務」→「拿給爸媽看」，用手機掃 QR 就連起來了。
      還沒有帳號的話，按右上「幫孩子開帳號」。</p></div>`}
    ${kids.map(kidCard).join('')}
  </section>`;
  $('[data-child]', box).onclick = () => createChild({ toast, refresh: reload ?? refresh, suggestPassword });
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
    <header><b>${esc(k.nickname)}</b><small>帳號 ${esc(k.login)}</small>${todo ? `<span class="chip warn">${todo} 件等你</span>` : '<span class="chip ok">這週都做完了</span>'}</header>
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
      if (v.grade) await auth.teacher.setGrade(r.student, v.grade).catch(() => toast('帳號開好了，年級沒存到，可以在全班總覽再設', true));
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
