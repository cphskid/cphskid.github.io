// 時光試煉島（孩子作答）：我的試煉卷 → 一題一頁作答 → 交卷看分數和解析 → 訂正錯的題。
// 改分都在伺服器（supabase/park_quiz.sql），這裡拿不到答案；交卷後才拿到正確答案和解析。
import { me, quiz } from '../js/auth.js';
import { renderAsk, answered, resultHtml, KIND_NAME } from '../js/quiz-items.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const IS_DEV = /^\/dev(\/|$)/.test(location.pathname);
if (IS_DEV) $('#env').hidden = false;

let who = null;
function toast(t, ms = 3200) {
  const el = $('#toast');
  el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}
const owl = (mood = '') => `<img class="qz-owl ${mood}" src="img/owl${mood ? '-' + mood : ''}.webp" alt="貓頭鷹考官">`;
function fail(e) {
  view.innerHTML = `<section class="qz-panel center">${owl('think')}<p>${esc(e.message || e)}</p>
    <a class="qz-btn" href="./">回試煉卷列表</a></section>`;
}

// ---------- 本機草稿：寫到一半關掉，下次回來答案還在 ----------
const draftKey = (paper) => `park.quiz.${who.id}.${paper}`;
function loadDraft(paper) {
  try { return JSON.parse(localStorage.getItem(draftKey(paper))) || { resp: {}, ms: {} }; } catch { return { resp: {}, ms: {} }; }
}
function saveDraft(paper, d) { try { localStorage.setItem(draftKey(paper), JSON.stringify(d)); } catch { /* 私密視窗：不存也能寫 */ } }
function dropDraft(paper) { try { localStorage.removeItem(draftKey(paper)); } catch { /* 沒關係 */ } }

// ---------- 列表 ----------
async function showList() {
  history.replaceState(null, '', location.pathname);
  const list = await quiz.mine();
  const todo = list.filter((p) => !p.done), done = list.filter((p) => p.done);
  const card = (p) => `<button type="button" class="qz-paper${p.done ? ' done' : ''}" data-paper="${p.id}">
      <span class="qz-scroll"></span>
      <span class="qz-pt"><b>${esc(p.title)}</b><small>${p.n} 題・${esc(p.by || '老師')}出的・${new Date(p.at).toLocaleDateString('zh-TW')}</small></span>
      ${p.done ? `<span class="qz-score">${p.score}<small>分</small></span>${p.wrong && !p.fixed ? '<em class="qz-tag">可以訂正</em>' : ''}`
               : `<em class="qz-tag go">${p.opened ? '繼續寫' : '新的'}</em>`}
    </button>`;
  view.innerHTML = `
    <section class="qz-hero">${owl()}<div class="qz-bubble">
      <b>${esc(who.nickname)}，歡迎來到時光試煉島。</b>
      <p>${todo.length ? `你有 <b>${todo.length}</b> 張試煉卷還沒寫。慢慢讀題，寫完可以拿時光幣。` : list.length ? '試煉卷都寫完了，做得好。寫錯的題記得訂正。' : '現在還沒有試煉卷。家長或老師出卷以後，信鴿會送信通知你。'}</p>
    </div></section>
    ${todo.length ? `<section class="qz-panel"><h2>還沒寫</h2><div class="qz-papers">${todo.map(card).join('')}</div></section>` : ''}
    ${done.length ? `<section class="qz-panel"><h2>寫完的</h2><div class="qz-papers">${done.map(card).join('')}</div></section>` : ''}
    <section class="qz-panel rules"><h2>試煉島的規則</h2><ul>
      <li>每張卷只能交一次；交了以後看得到答案和解析。</li>
      <li>時光幣：100 分 30 個、80 分以上 20 個、60 分以上 10 個、其他 5 個；20 題的卷多一半、30 題的卷兩倍。每星期最多 3 張卷給幣。</li>
      <li>寫錯的題可以訂正，全部改對再拿 5 個。</li>
      <li>覺得哪一題怪怪的，交卷後按「這題怪怪的？」告訴我們。</li>
    </ul></section>`;
  view.querySelectorAll('[data-paper]').forEach((b) => { b.onclick = () => go(b.dataset.paper); });
}

function go(paper) {
  history.pushState(null, '', `#p=${paper}`);
  route();
}

// ---------- 作答 ----------
async function showPaper(paper) {
  const p = await quiz.open(paper);
  if (p.done) return showResult(p);
  const d = loadDraft(paper);
  let i = Math.max(0, p.items.findIndex((x) => !answered(x.kind, x.show, d.resp[x.pos])));
  if (i >= p.items.length) i = 0;
  let t0 = performance.now();
  const stop = () => {
    const it = p.items[i];
    d.ms[it.pos] = (d.ms[it.pos] || 0) + Math.round(performance.now() - t0);
    t0 = performance.now();
    saveDraft(paper, d);
  };
  function paint() {
    const it = p.items[i];
    const left = p.items.filter((x) => !answered(x.kind, x.show, d.resp[x.pos])).length;
    view.innerHTML = `
      <section class="qz-sheet">
        <div class="qz-top"><b>${esc(p.title)}</b><span>第 ${i + 1} / ${p.items.length} 題・${KIND_NAME[it.kind]}</span></div>
        <div class="qz-dots">${p.items.map((x, k) => `<button type="button" class="qz-dot${k === i ? ' now' : ''}${answered(x.kind, x.show, d.resp[x.pos]) ? ' ok' : ''}" data-go="${k}" aria-label="第 ${k + 1} 題">${k + 1}</button>`).join('')}</div>
        <div id="ask"></div>
        <div class="qz-nav">
          <button type="button" class="qz-btn ghost" data-prev ${i ? '' : 'disabled'}>← 上一題</button>
          ${i + 1 < p.items.length ? '<button type="button" class="qz-btn" data-next>下一題 →</button>'
                                   : '<button type="button" class="qz-btn go" data-submit>交卷</button>'}
        </div>
        <p class="qz-left">${left ? `還有 ${left} 題沒寫` : '全部寫完了，檢查一下就可以交卷。'}</p>
        ${i + 1 < p.items.length ? '<button type="button" class="qz-link" data-submit>直接交卷</button>' : ''}
      </section>`;
    $('#ask').append(renderAsk(it, d.resp[it.pos], (v) => {
      if (v === null) delete d.resp[it.pos]; else d.resp[it.pos] = v;
      saveDraft(paper, d);
      const ok = answered(it.kind, it.show, d.resp[it.pos]);
      view.querySelector(`.qz-dot[data-go="${i}"]`)?.classList.toggle('ok', ok);
      const n = p.items.filter((x) => !answered(x.kind, x.show, d.resp[x.pos])).length;
      $('.qz-left').textContent = n ? `還有 ${n} 題沒寫` : '全部寫完了，檢查一下就可以交卷。';
    }));
    view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { stop(); i = +b.dataset.go; paint(); }; });
    $('[data-prev]', view).onclick = () => { stop(); i--; paint(); };
    $('[data-next]', view)?.addEventListener('click', () => { stop(); i++; paint(); });
    view.querySelectorAll('[data-submit]').forEach((b) => { b.onclick = confirmSubmit; });
    scrollTo({ top: 0 });
  }
  function confirmSubmit() {
    stop();
    const left = p.items.filter((x) => !answered(x.kind, x.show, d.resp[x.pos])).length;
    view.innerHTML = `<section class="qz-panel center">${owl('think')}
      <h2>${left ? `還有 ${left} 題沒寫完` : '確定要交卷了嗎？'}</h2>
      <p>${left ? '沒寫的題會算錯。' : ''}交了以後就不能改，可以看答案和解析，寫錯的再訂正。</p>
      <div class="qz-nav"><button type="button" class="qz-btn ghost" data-back>再檢查一下</button>
      <button type="button" class="qz-btn go" data-ok>交卷</button></div></section>`;
    $('[data-back]', view).onclick = () => { t0 = performance.now(); paint(); };
    $('[data-ok]', view).onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await quiz.submit(paper, p.items.map((x) => ({ pos: x.pos, resp: d.resp[x.pos] ?? null, ms: d.ms[x.pos] || 0 })));
        dropDraft(paper);
        showResult(await quiz.open(paper), r);
      } catch (err) { e.target.disabled = false; toast(err.message); }
    };
  }
  paint();
}

// ---------- 結果、訂正 ----------
function showResult(p, just = null) {
  const wrong = p.items.filter((x) => Number(x.got) < 1);
  const needFix = wrong.filter((x) => !(Number(x.fix_got) >= 1));
  const mood = p.score >= 80 ? 'happy' : p.score >= 60 ? '' : 'think';
  const said = p.score >= 100 ? '全部答對！你真的學會了。' : p.score >= 80 ? '很棒，只差一點點。看看錯的那幾題。'
    : p.score >= 60 ? '過關了！把錯的題看懂，下次會更好。' : '沒關係，試煉就是用來找出還不熟的地方。先看解析，再訂正一次。';
  const coinLine = just ? (just.capped ? '這星期已經拿過 3 張卷的時光幣了，這張先不給幣，但分數會記下來。'
    : just.coins ? `拿到 <b>${just.coins}</b> 個時光幣！` : '') : (p.coins ? `這張卷拿到 ${p.coins + (p.fix_coins || 0)} 個時光幣。` : '');
  view.innerHTML = `
    <section class="qz-hero result">${owl(mood)}<div class="qz-bubble">
      <span class="qz-big">${p.score}<small>分</small></span>
      <b>${esc(said)}</b>${coinLine ? `<p class="qz-coins">${coinLine}</p>` : ''}
    </div></section>
    ${needFix.length ? `<section class="qz-panel fixbox"><p>有 <b>${needFix.length}</b> 題可以訂正。全部改對，再拿 5 個時光幣。</p>
      <button type="button" class="qz-btn go" data-fix>開始訂正</button></section>`
      : wrong.length ? '<section class="qz-panel fixbox done"><p>✔ 錯的題都訂正好了！</p></section>' : ''}
    <section class="qz-panel"><h2>每一題的答案和解析</h2><ol class="qz-results">
      ${p.items.map((x, k) => resultHtml(x, k + 1, { flag: true })).join('')}</ol></section>
    <p class="center"><a class="qz-btn ghost" href="./">回試煉卷列表</a></p>`;
  $('[data-fix]', view)?.addEventListener('click', () => showFix(p, needFix));
  view.querySelectorAll('[data-flag]').forEach((b) => { b.onclick = () => askFlag(p.id, +b.dataset.flag, b); });
  scrollTo({ top: 0 });
}

function askFlag(paper, pos, btn) {
  const li = btn.closest('li');
  if (li.querySelector('.qz-flagbox')) return;
  const box = document.createElement('div');
  box.className = 'qz-flagbox';
  box.innerHTML = `<label>哪裡怪怪的？（可以不寫）<textarea maxlength="200" rows="2" placeholder="例如：我覺得第二個選項也對"></textarea></label>
    <button type="button" class="qz-btn small">送出</button>`;
  btn.after(box);
  box.querySelector('button').onclick = async () => {
    try {
      await quiz.flag(paper, pos, box.querySelector('textarea').value.trim());
      box.innerHTML = '<p>謝謝你！我們會再檢查這一題，如果真的出錯，會幫大家補分。</p>';
      btn.remove();
    } catch (e) { toast(e.message); }
  };
}

function showFix(p, items) {
  const resp = {};
  view.innerHTML = `<section class="qz-panel"><h2>訂正</h2><p class="qz-how">先看一下上一頁的解析，再重新作答。選項的順序和剛才一樣。</p>
    <ol class="qz-fixlist"></ol>
    <div class="qz-nav"><button type="button" class="qz-btn ghost" data-back>回去看解析</button>
    <button type="button" class="qz-btn go" data-send>送出訂正</button></div></section>`;
  const ol = $('.qz-fixlist', view);
  for (const x of items) {
    const li = document.createElement('li');
    li.append(renderAsk(x, null, (v) => { resp[x.pos] = v; }));
    ol.append(li);
  }
  $('[data-back]', view).onclick = () => showResult(p);
  $('[data-send]', view).onclick = async (e) => {
    const miss = items.filter((x) => !answered(x.kind, x.show, resp[x.pos])).length;
    if (miss) return toast(`還有 ${miss} 題沒寫`);
    e.target.disabled = true;
    try {
      const r = await quiz.fix(p.id, items.map((x) => ({ pos: x.pos, resp: resp[x.pos] })));
      toast(r.all ? (r.coins ? `全部改對了！拿到 ${r.coins} 個時光幣。` : '全部改對了！') : '還有幾題沒改對，再看一次解析。', 4200);
      showResult(await quiz.open(p.id));
    } catch (err) { e.target.disabled = false; toast(err.message); }
  };
  scrollTo({ top: 0 });
}

// ---------- 開門 ----------
async function route() {
  const m = /^#p=([0-9a-f-]{36})$/.exec(location.hash);
  try {
    if (m) await showPaper(m[1]); else await showList();
  } catch (e) { fail(e); }
}
addEventListener('popstate', route);

(async () => {
  try {
    who = await me();
  } catch { who = { kind: 'guest' }; }
  if (who.kind !== 'student') {
    view.innerHTML = `<section class="qz-panel center">${owl()}
      <h2>${who.kind === 'staff' ? '這裡是孩子寫試煉卷的地方' : '先回樂園登入'}</h2>
      <p>${who.kind === 'staff' ? '出卷、看報告請到老師後台的「時光試煉島」頁籤。' : '用你在樂園的帳號登入以後，再回到這裡。'}</p>
      <a class="qz-btn go" href="${who.kind === 'staff' ? '../teacher.html#quiz' : '../#map'}">${who.kind === 'staff' ? '去老師後台' : '回樂園登入'}</a></section>`;
    return;
  }
  route();
})();
