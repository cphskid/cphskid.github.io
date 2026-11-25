// 樂園共用問卷（2026-11-25，supabase/park_survey.sql）。
//
// 任何設施都能叫出來：樂園自己載，遊戲用 <script src="<樂園網址>js/survey.js"> 或動態載。
// 題目、獎勵、誰能寫都在資料庫 park_surveys，開新問卷不用改這支。孩子畫面不叫「問卷」，用每份自己的名字。
//
// 用法：
//   const s = await ParkSurvey.get('lab-v1');      // { title, can, done, locked, reward, ... }；沒登入、沒開放回 null
//   ParkSurvey.open('lab-v1', {
//     options: { played: [{ id: 'x-mirror', label: '鏡子反射', img: '…' }] },  // 題目 from:'played' 的選項由遊戲給
//     getToken: async () => '...',                  // 選填：遊戲自己的 supabase token；沒給就讀樂園共用的登入資料
//     onDone: (r) => {},                            // 送出後：r = { first, coins, top }
//   });
//
// 引導照樂園統一原則：一頁一題、滴答只說一句、下方目標寫下一個動作、第一題手指示範、能點的會發亮。
(function () {
  if (window.ParkSurvey) return;

  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const BASE = SRC.replace(/js\/survey\.js.*$/, '');
  const IS_DEV = /\/dev\/$/.test(new URL(BASE, location.href).pathname);
  const P = IS_DEV
    ? { url: 'https://dshggoumgqzpmzrpedyl.supabase.co', key: 'sb_publishable_l5msdhfjw1YYogWZ85K6VA_yZGDm2cV' }
    : { url: 'https://bxrppdsbhuhjluprohkf.supabase.co', key: 'sb_publishable_a99TJ4CiEW14ToPcoyn4KQ_NdoqXg2A' };
  const STORE = `sb-${new URL(P.url).hostname.split('.')[0]}-auth-token`;
  const TICK = (n) => `${BASE}img/tick/${n}.webp`;

  let getToken = null;
  async function token() {
    if (getToken) { try { const t = await getToken(); if (t) return t; } catch { /* 改讀共用登入資料 */ } }
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      const t = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
      if (t && (!s.expires_at || s.expires_at * 1000 > Date.now())) return t;
    } catch { /* 沒登入 */ }
    return null;
  }
  async function rpc(name, body) {
    const t = await token();
    if (!t) throw Object.assign(new Error('要先登入樂園才能寫喔'), { login: true });
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
      throw new Error(m || '送不出去，等一下再試');
    }
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const FACES = [[5, '😆', '超好玩'], [4, '🙂', '好玩'], [3, '😐', '普通'], [2, '😕', '有點無聊'], [1, '😫', '不好玩']];
  function device() {
    const w = innerWidth, h = innerHeight, touch = matchMedia('(pointer:coarse)').matches;
    const kind = !touch ? 'desktop' : Math.min(w, h) < 600 ? 'phone' : 'tablet';
    return `${kind}-${w >= h ? 'wide' : 'tall'}`;
  }

  const CSS = `
.psv{--wood:#7a4a24;--cream:#fff8e8;--ink:#3b2412;font-family:"Noto Sans TC",system-ui,sans-serif;color:var(--ink);-webkit-text-size-adjust:100%}
.psv-veil{position:fixed;inset:0;z-index:9100;display:flex;align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));background:rgba(16,32,40,.6)}
.psv-box{position:relative;display:flex;flex-direction:column;width:min(620px,100%);max-height:100%;border-radius:24px;border:4px solid var(--wood);background:var(--cream);box-shadow:0 6px 0 var(--wood),0 18px 40px rgba(0,0,0,.4);overflow:hidden;animation:psv-pop .3s cubic-bezier(.34,1.6,.5,1)}
@keyframes psv-pop{from{transform:scale(.88);opacity:0}}
.psv-top{display:flex;align-items:center;gap:10px;padding:10px 54px 6px 14px;background:linear-gradient(#2f6f73,#24585c);color:#fff}
.psv-top b{font:900 18px/1.2 "Noto Sans TC",system-ui,sans-serif}
.psv-dots{display:flex;gap:5px;margin-left:auto}
.psv-dots i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.35)}
.psv-dots i.on{background:#ffd36b}
.psv-x{position:absolute;right:10px;top:8px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font:900 18px/1 system-ui;cursor:pointer}
.psv-body{flex:1;overflow:auto;padding:12px 16px 6px}
.psv-ask{display:flex;align-items:flex-end;gap:10px;margin:0 0 12px}
.psv-ask img{width:64px;height:64px;object-fit:contain;flex:none}
.psv-ask p{position:relative;margin:0;padding:10px 14px;border-radius:16px;background:#fff;border:2px solid #e3c79a;font:900 19px/1.4 "Noto Sans TC",system-ui,sans-serif}
.psv-opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
.psv-opts.faces{grid-template-columns:repeat(5,1fr)}
.psv-opts.two{grid-template-columns:1fr 1fr}
.psv-o{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:84px;padding:8px 6px;border-radius:16px;border:3px solid #e3c79a;background:#fff;color:var(--ink);font:700 15px/1.25 "Noto Sans TC",system-ui,sans-serif;cursor:pointer;transition:transform .12s}
.psv-o:hover{transform:translateY(-2px)}
.psv-o .e{font-size:34px;line-height:1}
.psv-o img{width:56px;height:56px;object-fit:contain}
.psv-o.on{border-color:#e08a1e;background:#fff1cf;box-shadow:0 0 0 4px rgba(246,179,63,.45)}
.psv-o.on::after{content:"✓";position:absolute;right:6px;top:4px;color:#e08a1e;font:900 18px/1 system-ui}
.psv-o.glow{animation:psv-glow 1.2s ease-in-out infinite}
@keyframes psv-glow{50%{box-shadow:0 0 0 6px rgba(255,211,107,.8)}}
.psv-faces .psv-o{min-height:96px}
.psv textarea{box-sizing:border-box;width:100%;min-height:110px;padding:10px 12px;border-radius:14px;border:3px solid #e3c79a;background:#fff;font:500 17px/1.5 "Noto Sans TC",system-ui,sans-serif;color:var(--ink);resize:none}
.psv textarea:focus{outline:none;border-color:#e08a1e}
.psv-count{text-align:right;font:500 13px/1.4 system-ui;color:#8a6a4a}
.psv-foot{display:flex;align-items:center;gap:10px;padding:10px 14px 12px;border-top:2px dashed #e3c79a}
.psv-goal{flex:1;display:flex;align-items:center;gap:6px;font:900 16px/1.3 "Noto Sans TC",system-ui,sans-serif;color:#24585c}
.psv-goal.flash{animation:psv-flash .6s}
@keyframes psv-flash{30%{color:#e08a1e;transform:scale(1.04)}}
.psv-b{min-height:44px;padding:8px 16px;border-radius:14px;border:3px solid var(--wood);background:#fff;color:var(--ink);font:900 16px/1 "Noto Sans TC",system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.psv-b.go{background:linear-gradient(#f6b33f,#e08a1e);border-color:#9b5a12;color:#fff;text-shadow:0 1px 0 rgba(0,0,0,.25)}
.psv-b.wait{opacity:.55}
.psv-b.ghost{border-color:transparent;background:transparent;color:#8a6a4a}
.psv-hand{position:absolute;z-index:3;width:44px;height:44px;font-size:38px;line-height:1;pointer-events:none;animation:psv-tap 1.1s ease-in-out infinite;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))}
@keyframes psv-tap{50%{transform:translate(6px,8px) scale(.9)}}
.psv-err{margin:8px 0 0;color:#c0392b;font:700 14px/1.4 system-ui}
.psv-done{text-align:center;padding:8px 0 4px}
.psv-done img.t{width:110px;height:110px;object-fit:contain}
.psv-done h3{margin:6px 0;font:900 22px/1.3 "Noto Sans TC",system-ui,sans-serif}
.psv-coin{display:inline-block;margin:6px 0;padding:6px 14px;border-radius:99px;background:#ffe9a8;border:2px solid #e0a81e;font:900 18px/1.2 "Noto Sans TC",system-ui,sans-serif}
.psv-top3{display:flex;justify-content:center;gap:12px;margin:10px 0 0}
.psv-top3 figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:2px;font:700 13px/1.2 system-ui}
.psv-top3 img{width:54px;height:54px;object-fit:contain}
@media (max-height:460px){.psv-ask img{width:44px;height:44px}.psv-ask p{font-size:16px;padding:7px 10px}.psv-o{min-height:62px}.psv-o .e{font-size:26px}.psv-o img{width:40px;height:40px}.psv-faces .psv-o{min-height:70px}.psv textarea{min-height:70px}.psv-done img.t{width:70px;height:70px}}
@media (max-width:420px){.psv-opts.faces{grid-template-columns:repeat(5,1fr);gap:5px}.psv-faces .psv-o{padding:6px 2px}.psv-faces .psv-o span:not(.e){font-size:12px}.psv-faces .psv-o .e{font-size:30px}.psv-opts{grid-template-columns:repeat(auto-fill,minmax(90px,1fr))}.psv-body{padding:10px 10px 4px}.psv-foot{gap:6px;padding:8px 10px 10px}.psv-goal{font-size:14px}.psv-b{padding:8px 11px;font-size:15px}.psv-b.ghost{padding:8px 4px}.psv-ask p{font-size:17px}}
@media (prefers-reduced-motion:reduce){.psv-box,.psv-o.glow,.psv-hand{animation:none}}`;
  function injectCss() {
    if (document.getElementById('psv-css')) return;
    const st = document.createElement('style');
    st.id = 'psv-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  async function get(code, o) {
    if (o && o.getToken) getToken = o.getToken;
    if (!(await token())) return null;
    try { return await rpc('park_survey_get', { p_code: code }); } catch { return null; }
  }

  async function open(code, o = {}) {
    if (o.getToken) getToken = o.getToken;
    injectCss();
    let s;
    try { s = await rpc('park_survey_get', { p_code: code }); } catch (e) { s = { err: e.message }; }
    const veil = document.createElement('div');
    veil.className = 'psv psv-veil';
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');
    document.body.appendChild(veil);
    const close = () => { veil.remove(); clearTimeout(idle); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    let idle = 0;

    // 只是看看、還不能寫：滴答說一句就好
    if (!s || s.err || !s.can) {
      const say = !s ? '這本現在收起來了，下次再來看看！' : s.err ? s.err : !s.student ? '要用孩子的帳號登入才能寫喔！' : s.locked;
      veil.innerHTML = `<div class="psv-box"><div class="psv-top"><b>${esc(s && s.title || '留言本')}</b></div>
        <button class="psv-x" aria-label="關掉">✕</button>
        <div class="psv-body"><div class="psv-ask"><img src="${TICK('thinking')}" alt=""><p>${esc(say)}</p></div></div>
        <div class="psv-foot"><span class="psv-goal"></span><button class="psv-b go" data-ok>好</button></div></div>`;
      veil.querySelector('.psv-x').onclick = close;
      veil.querySelector('[data-ok]').onclick = close;
      return;
    }

    // 有 then 的 yesno 拆成兩步：先有／沒有，選「有」才出現接著那一步
    const pools = o.options || {};
    const optsOf = (q) => {
      const base = q.from ? (pools[q.from] || []) : (q.options || []);
      return [...base, ...((q.from && q.extra) || [])];
    };
    const names = {};
    const ans = Object.assign({}, s.answers || {});
    let text = s.text || '';
    const started = Date.now();
    const steps = [];
    for (const q of s.questions) {
      if (q.type === 'pick' && q.from && !optsOf(q).length) continue;   // 遊戲沒給選項就略過這題
      steps.push({ q });
      if (q.type === 'yesno' && q.then) steps.push({ q: Object.assign({ id: q.id, follow: true }, q.then), parent: q });
    }
    const visible = () => steps.filter((st) => !st.parent || ans[st.parent.id] !== false);
    let at = 0;
    let shownHand = false;
    const total = () => visible().filter((st) => !st.parent).length;
    const mainIndex = (st) => visible().filter((x) => !x.parent).indexOf(st.parent ? visible().find((x) => x.q === st.parent) : st);

    function answered(st) {
      const q = st.q, v = ans[q.id];
      if (q.type === 'text') return true;
      if (st.parent) return Array.isArray(v) && v.length > 0;
      if (q.type === 'yesno') return v === false || v === true || Array.isArray(v);
      if (q.type === 'pick' && q.multi) return Array.isArray(v) && v.length > 0;
      return v !== undefined && v !== null;
    }

    function paint(flash) {
      clearTimeout(idle);
      const list = visible();
      const st = list[at];
      const q = st.q;
      const last = at === list.length - 1;
      const n = total();
      const cur = mainIndex(st);
      let opts = '';
      if (q.type === 'face') {
        opts = `<div class="psv-opts faces psv-faces">${FACES.map(([v, e, l]) =>
          `<button class="psv-o ${ans[q.id] === v ? 'on' : ''}" data-v="${v}"><span class="e">${e}</span><span>${l}</span></button>`).join('')}</div>`;
      } else if (q.type === 'yesno' && !st.parent) {
        const v = ans[q.id];
        opts = `<div class="psv-opts two"><button class="psv-o ${v === true || Array.isArray(v) ? 'on' : ''}" data-v="yes"><span class="e">🙋</span><span>有</span></button>
          <button class="psv-o ${v === false ? 'on' : ''}" data-v="no"><span class="e">👌</span><span>沒有</span></button></div>`;
      } else if (q.type === 'pick') {
        const cur = ans[q.id];
        const on = (id) => (Array.isArray(cur) ? cur.includes(id) : cur === id);
        opts = `<div class="psv-opts">${optsOf(q).map((x) => `<button class="psv-o ${on(x.id) ? 'on' : ''}" data-v="${esc(x.id)}">
          ${x.img ? `<img src="${esc(x.img)}" alt="">` : `<span class="e">${esc(x.icon || '✨')}</span>`}<span>${esc(x.label)}</span></button>`).join('')}</div>`;
      } else if (q.type === 'text') {
        opts = `<textarea maxlength="${q.max || 100}" placeholder="想到什麼都可以寫">${esc(text)}</textarea><div class="psv-count"><span>${text.length}</span> / ${q.max || 100}</div>`;
      }
      const needBtn = q.multi || q.type === 'text' || st.parent;
      const ready = answered(st);
      const btn = q.type === 'text'
        ? `<button class="psv-b go" data-next>${text.trim() ? '寫好了' : '不寫，送出'}</button>`
        : needBtn || (last && ready) ? `<button class="psv-b ${ready ? 'go' : 'wait'}" data-next>${last ? '送出' : '好了'}</button>` : '';
      veil.innerHTML = `<div class="psv-box"><div class="psv-top"><b>${esc(s.title)}</b>
          <span class="psv-dots">${Array.from({ length: n }, (_, i) => `<i class="${i <= cur ? 'on' : ''}"></i>`).join('')}</span></div>
        <button class="psv-x" aria-label="關掉">✕</button>
        <div class="psv-body"><div class="psv-ask"><img src="${TICK(at === 0 ? 'wave' : q.type === 'text' ? 'happy' : 'point')}" alt=""><p>${esc(q.q)}</p></div>${opts}<p class="psv-err" hidden></p></div>
        <div class="psv-foot">${at > 0 ? '<button class="psv-b ghost" data-back>← 上一題</button>' : ''}
          <span class="psv-goal ${flash ? 'flash' : ''}">👉 ${esc(q.goal || (q.type === 'text' ? '可以打字，也可以跳過' : '點一個'))}</span>${btn}</div></div>`;

      veil.querySelector('.psv-x').onclick = close;
      const back = veil.querySelector('[data-back]');
      if (back) back.onclick = () => { at--; paint(true); };
      const err = veil.querySelector('.psv-err');
      const nextBtn = veil.querySelector('[data-next]');
      const go = () => {
        if (!answered(st)) {   // 沒準備好也能按：說還差什麼，不要安靜沒反應
          err.hidden = false; err.textContent = q.multi || st.parent ? '先點至少一個喔！' : '先點一個喔！';
          glow(); return;
        }
        if (at < visible().length - 1) { at++; paint(true); } else submit();
      };
      if (nextBtn) nextBtn.onclick = go;
      const ta = veil.querySelector('textarea');
      if (ta) {
        ta.oninput = () => {
          text = ta.value;
          veil.querySelector('.psv-count span').textContent = text.length;
          const b = veil.querySelector('[data-next]'); if (b) b.textContent = text.trim() ? '寫好了' : '不寫，送出';
        };
      }
      veil.querySelectorAll('.psv-o').forEach((b) => {
        b.onclick = () => {
          const v = b.dataset.v;
          if (q.type === 'face') ans[q.id] = Number(v);
          else if (q.type === 'yesno' && !st.parent) ans[q.id] = v === 'yes' ? (Array.isArray(ans[q.id]) ? ans[q.id] : true) : false;
          else if (q.multi) {
            const arr = Array.isArray(ans[q.id]) ? ans[q.id].slice() : [];
            const i = arr.indexOf(v);
            if (i >= 0) arr.splice(i, 1);
            else {
              if (q.max && arr.length >= q.max) { err.hidden = false; err.textContent = `最多點 ${q.max} 個，想換就先點掉一個`; return; }
              arr.push(v);
            }
            ans[q.id] = arr;
          } else ans[q.id] = v;
          const opt = optsOf(q).find((x) => x.id === v);
          if (opt && q.from) names[v] = opt.label;
          shownHand = true;
          // 單選點完自動下一題（最後一題除外，留給「送出」）
          if (!q.multi && !st.parent && q.type !== 'text' && at < visible().length - 1) { at++; setTimeout(() => paint(true), 160); }
          else paint(false);
        };
      });
      // 第一題第一下示範；停 8 秒手指再出來
      const hand = () => {
        const tgt = veil.querySelector('.psv-o:not(.on)') || nextBtn;
        if (!tgt || !veil.isConnected) return;
        const box = veil.querySelector('.psv-box').getBoundingClientRect(), r = tgt.getBoundingClientRect();
        const h = document.createElement('div');
        h.className = 'psv-hand'; h.textContent = '👆';
        h.style.left = `${r.left - box.left + r.width * 0.62}px`; h.style.top = `${r.top - box.top + r.height * 0.55}px`;
        veil.querySelector('.psv-box').appendChild(h);
      };
      const glow = () => veil.querySelectorAll('.psv-o:not(.on)').forEach((b) => b.classList.add('glow'));
      if (!shownHand && at === 0) requestAnimationFrame(hand);
      idle = setTimeout(() => { if (!answered(st)) { hand(); glow(); } }, 8000);
    }

    async function submit() {
      const sayQ = s.questions.find((q) => q.type === 'text');
      const answers = {};
      for (const q of s.questions) if (q.type !== 'text' && ans[q.id] !== undefined) answers[q.id] = ans[q.id];
      // 遊戲給的選項（例如玩過哪些）也存起來：後台才算得出「卡住率」＝點卡住的人÷有這個選項的人
      const pool = {};
      for (const [k, list] of Object.entries(pools)) {
        pool[k] = (list || []).map((x) => x.id).slice(0, 80);
        for (const x of list || []) names[x.id] = x.label;
      }
      if (Object.keys(pool).length) answers._pool = pool;
      for (const q of s.questions) {   // 「有」但沒有接著點：記成 true
        if (q.type === 'yesno' && ans[q.id] === true) answers[q.id] = true;
      }
      const btn = veil.querySelector('[data-next]');
      if (btn) { btn.disabled = true; btn.textContent = '送出中…'; }
      try {
        const r = await rpc('park_survey_submit', {
          p_code: code, p_answers: answers, p_text: sayQ ? text.trim() || null : null,
          p_secs: Math.round((Date.now() - started) / 1000), p_device: device(), p_names: names,
        });
        thanks(r);
        try { o.onDone && o.onDone(r); } catch { /* 遊戲自己的事 */ }
      } catch (e) {
        const err = veil.querySelector('.psv-err');
        if (err) { err.hidden = false; err.textContent = e.message; }
        if (btn) { btn.disabled = false; btn.textContent = '再送一次'; }
      }
    }

    function thanks(r) {
      clearTimeout(idle);
      const all = Object.values(pools).flat();
      const top = (r.top || []).map((id) => all.find((x) => x.id === id)).filter(Boolean).slice(0, 3);
      veil.innerHTML = `<div class="psv-box"><div class="psv-top"><b>${esc(s.title)}</b></div>
        <button class="psv-x" aria-label="關掉">✕</button>
        <div class="psv-body"><div class="psv-done"><img class="t" src="${TICK('cheer')}" alt="">
          <h3>${esc(r.thanks || '謝謝你！')}</h3>
          ${r.coins ? `<div class="psv-coin">時光幣 +${r.coins}${s.stamp ? '，還有一枚勳章' : ''}，回樂園就會入帳</div>` : r.first ? '' : '<p>答案改好了！</p>'}
          ${top.length ? `<p>大家目前最喜歡的：</p><div class="psv-top3">${top.map((x) => `<figure>${x.img ? `<img src="${esc(x.img)}" alt="">` : `<span class="e">${esc(x.icon || '✨')}</span>`}<figcaption>${esc(x.label)}</figcaption></figure>`).join('')}</div>` : ''}
        </div></div>
        <div class="psv-foot"><span class="psv-goal">👉 按「好」回去繼續玩</span><button class="psv-b go" data-ok>好</button></div></div>`;
      veil.querySelector('.psv-x').onclick = close;
      veil.querySelector('[data-ok]').onclick = close;
    }

    paint(false);
  }

  window.ParkSurvey = { get, open };
})();
