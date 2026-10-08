// 樂園共用的「💬 問題回報」（2026-10-08）。
//
// 樂園和每個遊戲都用這一支：樂園自己載，遊戲用 <script src="<樂園網址>js/feedback.js"> 載。
// 回報寫進守護異世界原本那張 feedback 表（submit_feedback / my_feedback / seen_my_feedback），
// 所以三邊的回報都在同一個收件匣：樂園教師後台 teacher.html#feedback。
// context.game 記是哪個遊戲送的（舊的守護異世界回報沒有這欄）。
//
// 小朋友描述 bug 通常只會寫「壞掉了」，所以真正有用的是自動附上的東西：
// 哪個遊戲、哪個畫面、網址、裝置、螢幕大小、最近按過的按鈕、最近跳出的錯誤。
//
// 用法：
//   ParkFeedback.mount({
//     game: 'island_pioneer',              // 必填：設施代碼
//     getToken: async () => '...',         // 選填：遊戲自己的 supabase 拿 access token（會自動換新）；沒給就讀共用的登入資料
//     context: () => ({ screen: 'ch3-2' }),// 選填：送出當下要附上的東西，screen 會另外存一欄
//     fab: true,                           // 選填：要不要放浮動按鈕；false 就自己做按鈕叫 ParkFeedback.open()
//     onDot: (n) => {},                    // 選填：「我的回報」有幾則新回覆，給自己做的按鈕亮紅點
//   })
(function () {
  if (window.ParkFeedback) return;

  // 用這支程式自己的網址判斷測試站或正式站：/dev/js/feedback.js → 測試庫
  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const BASE = SRC.replace(/js\/feedback\.js.*$/, '');
  const IS_DEV = /\/dev\/$/.test(new URL(BASE, location.href).pathname);
  // 只放公開的 publishable key，跟 js/auth.js 一樣
  const P = IS_DEV
    ? { url: 'https://dshggoumgqzpmzrpedyl.supabase.co', key: 'sb_publishable_l5msdhfjw1YYogWZ85K6VA_yZGDm2cV' }
    : { url: 'https://bxrppdsbhuhjluprohkf.supabase.co', key: 'sb_publishable_a99TJ4CiEW14ToPcoyn4KQ_NdoqXg2A' };
  const STORE = `sb-${new URL(P.url).hostname.split('.')[0]}-auth-token`;

  let opts = { game: 'park', fab: true };
  let mine = null;
  let fab = null;

  // ---------- 自動附上的東西 ----------
  const taps = [];
  const errors = [];
  const hhmmss = () => new Date().toTimeString().slice(0, 8);
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest && e.target.closest('button, a, [role=button]');
    if (!el || el.closest('.pfb, [data-pfb]')) return;
    const label = (el.textContent || el.getAttribute('aria-label') || el.className || '?').trim().replace(/\s+/g, ' ');
    taps.push(`${hhmmss()} ${String(label).slice(0, 30)}${el.disabled ? '（停用中）' : ''}`);
    if (taps.length > 5) taps.shift();
  }, true);
  const keep = (m) => { errors.push(`${hhmmss()} ${m}`.slice(0, 200)); if (errors.length > 5) errors.shift(); };
  window.addEventListener('error', (e) => keep(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) => keep(e.reason instanceof Error ? e.reason.message : String(e.reason)));

  // ---------- 資料庫 ----------
  async function token() {
    if (opts.getToken) {
      try { const t = await opts.getToken(); if (t) return t; } catch { /* 改讀共用登入資料 */ }
    }
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      const t = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
      if (t && (!s.expires_at || s.expires_at * 1000 > Date.now())) return t;
    } catch { /* 沒登入 */ }
    return null;
  }
  async function rpc(name, body) {
    const t = await token();
    if (!t) throw Object.assign(new Error('要先登入樂園才能回報'), { login: true });
    let res;
    try {
      res = await fetch(`${P.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: P.key, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch { throw new Error('連不上網路，檢查一下網路再試一次'); }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const m = (data && data.message) || '';
      if (res.status === 401 || /jwt/i.test(m)) throw Object.assign(new Error('登入過期了，重新整理網頁再試一次'), { login: true });
      if (/請先登入/.test(m)) throw Object.assign(new Error('要先登入樂園才能回報'), { login: true });
      throw new Error(m || '送不出去，等一下再試');
    }
    return data;
  }

  // ---------- 狀態說法（跟守護異世界一樣） ----------
  const KINDS = [
    { id: 'bug', label: '🐞 壞掉了', hint: '例如：按了沒反應、畫面卡住、東西不見了' },
    { id: 'confusing', label: '❓ 看不懂', hint: '例如：不知道下一步要做什麼' },
    { id: 'idea', label: '💡 我有想法', hint: '例如：希望多一個什麼功能' },
  ];
  const MY_STATUS = {
    new: ['已收到', 'wait', '我們收到了，會盡快來看。'],
    bug: ['處理中', 'work', '我們確認這是問題，正在修。'],
    unclear: ['處理中', 'work', '我們正在討論要怎麼處理。'],
    request: ['好點子', 'work', '謝謝你的想法！已經放進想做的清單。'],
    fixed: ['修好了', 'done', '修好了！重新整理網頁就會是新版。謝謝你幫忙！'],
    dup: ['已處理', 'close', '已經有人回報過一樣的問題，我們會一起處理。'],
    wontfix: ['看過了', 'close', '我們看過了，這次先不改，謝謝你告訴我們。'],
  };
  const isUnread = (r) => !!r.updated_at && (!r.seen_at || Date.parse(r.updated_at) > Date.parse(r.seen_at));
  const unread = () => (mine || []).filter(isUnread).length;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function paintDot() {
    const n = unread();
    if (fab) fab.querySelector('i').hidden = n === 0;
    if (opts.onDot) try { opts.onDot(n); } catch { /* 遊戲自己的紅點壞了不影響回報 */ }
  }
  async function loadMine() {
    try { mine = await rpc('my_feedback'); } catch { mine = mine || null; }
    paintDot();
  }

  // ---------- 畫面 ----------
  const CSS = `
.pfb{--pfb-wood:#7a4a24;--pfb-cream:#fff6e0;--pfb-ink:#3b2412;font-family:"Noto Sans TC",system-ui,sans-serif;color:var(--pfb-ink);-webkit-text-size-adjust:100%}
.pfb-fab{position:fixed;z-index:9000;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:4px;padding:7px 13px;border-radius:999px;border:3px solid var(--pfb-wood);background:var(--pfb-cream);box-shadow:0 3px 0 var(--pfb-wood),0 6px 12px rgba(0,0,0,.25);font:900 15px/1 "Noto Sans TC",system-ui,sans-serif;color:var(--pfb-ink);cursor:pointer}
.pfb-fab:hover,.pfb-fab:focus-visible{transform:translateY(-2px);outline:none}
.pfb-fab i,.pfb-tabs i{display:inline-block;width:11px;height:11px;border-radius:50%;background:#e2553f;border:2px solid #fff;margin-left:2px;vertical-align:top}
.pfb-fab i[hidden],.pfb-tabs i[hidden]{display:none}
.pfb-veil{position:fixed;inset:0;z-index:9001;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(20,30,50,.55)}
.pfb-box{position:relative;width:min(460px,100%);max-height:calc(100dvh - 24px);overflow:auto;padding:18px 18px 16px;border-radius:22px;border:4px solid var(--pfb-wood);background:var(--pfb-cream);box-shadow:0 6px 0 var(--pfb-wood),0 18px 36px rgba(0,0,0,.35)}
.pfb-veil.pop .pfb-box{animation:pfb-pop .3s cubic-bezier(.34,1.6,.5,1)}
@keyframes pfb-pop{from{transform:scale(.85);opacity:0}}
.pfb h2{margin:0 0 10px;font:900 22px/1.2 "Noto Sans TC",system-ui,sans-serif}
.pfb p{margin:8px 0;font:500 15px/1.55 "Noto Sans TC",system-ui,sans-serif}
.pfb-x{position:absolute;right:10px;top:10px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(122,74,36,.12);font:900 18px/1 system-ui;color:var(--pfb-wood);cursor:pointer}
.pfb-tabs,.pfb-kinds,.pfb-btns{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.pfb-btns{justify-content:flex-end;margin:12px 0 0}
.pfb button.b{min-height:40px;padding:8px 14px;border-radius:14px;border:2px solid var(--pfb-wood);background:#fff;color:var(--pfb-ink);font:700 15px/1 "Noto Sans TC",system-ui,sans-serif;cursor:pointer}
.pfb button.b.on,.pfb button.b.go{background:linear-gradient(#f6b33f,#e08a1e);border-color:#9b5a12;color:#fff;text-shadow:0 1px 0 rgba(0,0,0,.25)}
.pfb button.b:disabled{opacity:.5;cursor:default}
.pfb textarea{box-sizing:border-box;width:100%;min-height:96px;padding:10px 12px;border-radius:14px;border:2px solid #d8b98a;background:#fff;font:500 16px/1.5 "Noto Sans TC",system-ui,sans-serif;color:var(--pfb-ink);resize:vertical}
.pfb textarea:focus{outline:3px solid #f6b33f;border-color:var(--pfb-wood)}
.pfb .note{font-size:13px;color:#8a6a4a}
.pfb .err{color:#c0392b;font-weight:700}
.pfb a.b{display:inline-block;text-decoration:none;min-height:auto}
.pfb-list{display:flex;flex-direction:column;gap:8px}
.pfb-item{padding:10px 12px;border-radius:14px;background:#fff;border:2px solid #ead3ad}
.pfb-item.fresh{border-color:#e2553f;box-shadow:0 0 0 3px rgba(226,85,63,.15)}
.pfb-row{display:flex;align-items:center;gap:8px;font:700 13px/1 "Noto Sans TC",system-ui,sans-serif;color:#8a6a4a}
.pfb-badge{padding:4px 8px;border-radius:99px;color:#fff;background:#9a8a7a}
.pfb-badge.wait{background:#5b8bd6}.pfb-badge.work{background:#e08a1e}.pfb-badge.done{background:#3a9d5d}
.pfb-msg{margin:6px 0 4px;font:500 15px/1.5 "Noto Sans TC",system-ui,sans-serif;white-space:pre-wrap;word-break:break-word}
.pfb-reply{font:500 14px/1.5 "Noto Sans TC",system-ui,sans-serif;color:#5a3a1a;background:#fff6e0;border-radius:10px;padding:6px 10px}
@media (max-width:560px){.pfb-fab b{display:none}.pfb-fab{padding:7px 10px}}
@media (prefers-reduced-motion:reduce){.pfb-veil.pop .pfb-box{animation:none}}`;

  function injectCss() {
    if (document.getElementById('pfb-css')) return;
    const st = document.createElement('style');
    st.id = 'pfb-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  let veil = null;
  function close() { if (veil) { veil.remove(); veil = null; } }

  function open(tab) {
    injectCss();
    close();
    const fresh = new Set((mine || []).filter(isUnread).map((r) => r.id));
    let cur = tab || (fresh.size ? 'mine' : 'write');
    let kind = 'bug';
    let text = '';
    let state = 'edit';
    let error = '';
    let login = false;

    veil = document.createElement('div');
    veil.className = 'pfb pfb-veil pop';
    setTimeout(() => veil && veil.classList.remove('pop'), 400);   // 只有打開時彈一下，換分頁不要每次都彈
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');
    veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
    document.body.appendChild(veil);

    const loginLink = () => login ? `<a class="b go" href="${esc(BASE)}">回樂園登入</a>` : '';
    function paint() {
      if (!veil) return;
      if (state === 'done') {
        veil.innerHTML = `<div class="pfb-box"><h2>收到了，謝謝你！</h2>
          <p>我們看過之後會處理。處理的進度和回覆，之後按「💬 問題回報」→「我的回報」就看得到。</p>
          <div class="pfb-btns"><button class="b go" data-close>好</button></div></div>`;
      } else {
        const n = unread();
        const body = cur === 'mine'
          ? (mine === null ? `<p class="note">讀取中…</p>`
            : mine.length === 0 ? `<p class="note">你還沒有回報過。遇到問題或有想法，隨時告訴我們！</p>`
            : `<div class="pfb-list">${mine.map((r) => {
                const [label, tone, say] = MY_STATUS[r.status] || MY_STATUS.new;
                return `<div class="pfb-item${fresh.has(r.id) ? ' fresh' : ''}">
                  <div class="pfb-row"><span class="pfb-badge ${tone}">${label}</span><span>${new Date(r.created_at).toLocaleDateString('zh-TW')}</span>${fresh.has(r.id) ? '<span style="color:#e2553f">新消息</span>' : ''}</div>
                  <div class="pfb-msg">${esc(r.message)}</div>
                  <div class="pfb-reply">${r.reply ? '💌 ' + esc(r.reply) : say}</div></div>`;
              }).join('')}</div>`)
            + (error ? `<p class="err">${esc(error)}</p>` : '')
            + `<div class="pfb-btns">${loginLink()}<button class="b" data-close>關閉</button></div>`
          : `<div class="pfb-kinds">${KINDS.map((k) => `<button class="b${k.id === kind ? ' on' : ''}" data-kind="${k.id}">${k.label}</button>`).join('')}</div>
            <textarea maxlength="500" rows="4" placeholder="${esc(KINDS.find((k) => k.id === kind).hint)}">${esc(text)}</textarea>
            <p class="note">會自動附上你在哪個遊戲、哪個畫面和用什麼裝置，不用另外寫。</p>
            ${error ? `<p class="err">${esc(error)}</p>` : ''}
            <div class="pfb-btns">${loginLink()}<button class="b" data-close>取消</button>
              <button class="b go" data-send ${!text.trim() || state === 'sending' ? 'disabled' : ''}>${state === 'sending' ? '送出中…' : '送出'}</button></div>`;
        veil.innerHTML = `<div class="pfb-box"><button class="pfb-x" data-close aria-label="關閉">✕</button><h2>💬 問題回報</h2>
          <div class="pfb-tabs"><button class="b${cur === 'write' ? ' on' : ''}" data-tab="write">✏️ 寫新的</button>
          <button class="b${cur === 'mine' ? ' on' : ''}" data-tab="mine">📬 我的回報<i ${n || fresh.size ? '' : 'hidden'}></i></button></div>${body}</div>`;
      }
      veil.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
      veil.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { cur = b.dataset.tab; error = ''; showTab(); }; });
      veil.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { kind = b.dataset.kind; paint(); focusText(); }; });
      const ta = veil.querySelector('textarea');
      if (ta) ta.oninput = () => {
        text = ta.value;
        const send = veil.querySelector('[data-send]');
        if (send) send.disabled = !text.trim() || state === 'sending';
      };
      const send = veil.querySelector('[data-send]');
      if (send) send.onclick = submit;
    }
    function focusText() {
      const ta = veil && veil.querySelector('textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
    async function showTab() {
      paint();
      if (cur !== 'mine') return;
      try {
        mine = await rpc('my_feedback');
        if (mine.some(isUnread)) {
          await rpc('seen_my_feedback');
          const now = new Date().toISOString();
          mine = mine.map((r) => ({ ...r, seen_at: now }));
        }
      } catch (e) { error = e.message; login = !!e.login; if (mine === null) mine = []; }
      paintDot();
      paint();
    }
    async function submit() {
      state = 'sending'; error = ''; paint();
      let extra = {};
      try { extra = (opts.context && opts.context()) || {}; } catch { /* 遊戲給的資料壞了照樣送 */ }
      const { screen, ...rest } = extra;
      try {
        await rpc('submit_feedback', {
          p_kind: kind,
          p_message: text,
          p_screen: String(screen || location.hash || location.pathname).slice(0, 40),
          p_context: {
            game: opts.game,
            ...rest,
            url: (location.pathname + location.search + location.hash).slice(0, 200),
            taps: [...taps],
            errors: [...errors],
            ua: navigator.userAgent.slice(0, 200),
            view: `${innerWidth}x${innerHeight}`,
          },
        });
        state = 'done';
        text = '';
        loadMine();
      } catch (e) {
        state = 'edit'; error = e.message; login = !!e.login;
      }
      paint();
    }
    showTab();
    if (cur === 'write') setTimeout(focusText, 50);
  }

  function mount(o) {
    opts = { ...opts, ...(o || {}) };
    injectCss();
    if (opts.fab && !fab) {
      fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'pfb pfb-fab';
      fab.setAttribute('aria-label', '問題回報');
      fab.innerHTML = '💬<b>問題回報</b><i hidden></i>';
      fab.onclick = () => open();
      (opts.fabParent || document.body).appendChild(fab);
    }
    loadMine();
  }

  window.ParkFeedback = { mount, open, refresh: loadMine, close };
  // 遊戲可能比這支先準備好：先把設定放在 window.ParkFeedbackConfig，這裡載好就自己掛上
  if (window.ParkFeedbackConfig) mount(window.ParkFeedbackConfig);
})();
