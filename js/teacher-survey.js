// 後台 → 管理 → 問卷（2026-11-25，supabase/park_survey.sql）。只有管理員看（Chuck 決定老師不看）。
//
// 2026-11-25 Chuck：要能分類、分日期管理，不然問卷一多會亂七八糟。所以分兩層：
//   1. 問卷清單：每份一列（類型、設施、開放期間、狀態、份數、待處理留言），可用設施／類型／狀態篩選
//   2. 點進一份：日期區間（今天／近 7 天／近 30 天／本月／自訂）→ 每日份數、統計長條、卡住率
//      ＋留言管理：分類（好評／建議／卡住／壞掉／其他）、處理狀態（新的／看過／處理好了）、備註，可勾選一次改多筆
// 統計在這裡算（park_survey_admin 回區間內每一份作答），題目怎麼變都照題型畫。
import * as auth from './auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = (s) => (s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : '');
const FACE = { 5: '😆 超好玩', 4: '🙂 好玩', 3: '😐 普通', 2: '😕 有點無聊', 1: '😫 不好玩' };
const DEV = { phone: '手機', tablet: '平板', desktop: '電腦' };
const devOf = (d) => DEV[String(d || '').split('-')[0]] ?? '—';
const KIND = { feedback: '心得建議', event: '活動', test: '試玩測試', other: '其他' };
const STATUS = { open: ['開放中', 'ok'], soon: ['還沒開始', ''], ended: ['已結束', 'old'], off: ['收起來', 'bad'] };
const TAG = { praise: '👍 好評', idea: '💡 建議', stuck: '❓ 卡住看不懂', bug: '🐞 壞掉', other: '📝 其他' };
const STATE = { new: '新的', seen: '看過', done: '處理好了' };
const PAGE = 30;

// 清單篩選、目前打開哪一份、那一份的篩選（換頁籤回來還在）
let lf = { fac: '', kind: '', status: '' };
let open = null;
let rng = { preset: 'all', from: '', to: '' };
let filt = { grade: '', dev: '', fast: false };
let mf = { state: 'new', tag: '', q: '', page: 0 };

export async function renderSurveys(host) {
  if (open) return paintOne(host);
  host.innerHTML = '<section class="panel"><p class="lead">讀取中…</p></section>';
  let list;
  try { list = await auth.survey.list(); }
  catch (e) { host.innerHTML = `<section class="panel"><p class="tip">${esc(e.message)}</p></section>`; return; }
  const facs = [...new Map(list.map((s) => [s.facility, s.facility_name])).entries()];
  const rows = list.filter((s) => (!lf.fac || s.facility === lf.fac) && (!lf.kind || s.kind === lf.kind) && (!lf.status || s.status === lf.status));
  const todo = list.reduce((a, s) => a + Number(s.todo), 0);
  const per = (s) => (s.opens_at || s.closes_at ? `${s.opens_at ? md(ymd(new Date(s.opens_at))) : '一開始'} ～ ${s.closes_at ? md(ymd(new Date(s.closes_at))) : '不限'}` : '不限期');
  host.innerHTML = `<section class="panel">
      <div class="head"><h2>孩子的問卷（${list.length} 份）</h2>${todo ? `<span class="tag gold">${todo} 則新留言待看</span>` : ''}</div>
      <p class="lead">孩子在遊戲裡寫的問卷（孩子畫面不叫問卷，例如實驗室的「留言本」）。每份第一次寫完給時光幣、一個帳號只算一份，再寫是改答案。
        點一份進去看統計、管理留言。開新問卷請告訴 Claude（題目、獎勵、放哪裡、開放期間都是設定，不用改程式）。</p>
      <div class="row sv-filt">
        <label>設施 <select data-l="fac"><option value="">全部</option>${facs.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')}</select></label>
        <label>類型 <select data-l="kind"><option value="">全部</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>狀態 <select data-l="status"><option value="">全部</option>${Object.entries(STATUS).map(([k, [v]]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      ${rows.length ? `<div class="tablewrap"><table class="adm sv-list">
        <thead><tr><th>問卷</th><th>類型</th><th>設施</th><th>開放期間</th><th>狀態</th><th>份數</th><th>新留言</th><th>最近一份</th><th></th></tr></thead>
        <tbody>${rows.map((s) => `<tr data-open="${esc(s.code)}">
          <td><b>${esc(s.title)}</b><small class="mono">${esc(s.code)}・${s.reward} 幣</small></td>
          <td class="nowrap">${esc(KIND[s.kind] ?? s.kind)}</td>
          <td class="nowrap">${esc(s.facility_name)}</td>
          <td class="nowrap">${esc(per(s))}</td>
          <td class="nowrap"><span class="tag ${STATUS[s.status]?.[1] ?? ''}">${esc(STATUS[s.status]?.[0] ?? s.status)}</span></td>
          <td class="num">${s.answers}</td>
          <td class="num">${Number(s.todo) ? `<b class="sv-new">${s.todo}</b>` : '0'}<small>共 ${s.with_text}</small></td>
          <td class="nowrap">${s.last_at ? esc(hm(s.last_at)) : '—'}</td>
          <td><button class="btn small">看</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="tip">沒有符合的問卷。</p>'}
    </section>`;
  host.querySelectorAll('[data-l]').forEach((el) => {
    el.value = lf[el.dataset.l];
    el.onchange = () => { lf = { ...lf, [el.dataset.l]: el.value }; renderSurveys(host); };
  });
  host.querySelectorAll('[data-open]').forEach((tr) => {
    tr.onclick = () => { open = tr.dataset.open; mf = { state: 'new', tag: '', q: '', page: 0 }; renderSurveys(host); };
  });
}

// 日期區間 → from／to（臺灣時間的日期字串）
function range() {
  const now = new Date(), t = ymd(now);
  if (rng.preset === 'today') return [t, t];
  if (rng.preset === '7') return [ymd(new Date(now - 6 * 864e5)), t];
  if (rng.preset === '30') return [ymd(new Date(now - 29 * 864e5)), t];
  if (rng.preset === 'month') return [`${t.slice(0, 8)}01`, t];
  if (rng.preset === 'custom') return [rng.from || null, rng.to || null];
  return [null, null];
}

async function paintOne(host) {
  host.innerHTML = '<section class="panel"><p class="lead">讀取中…</p></section>';
  const [from, to] = range();
  let d;
  try { d = await auth.survey.admin(open, from, to); }
  catch (e) { host.innerHTML = `<section class="panel"><button class="ghost small" data-back>← 所有問卷</button><p class="tip">${esc(e.message)}</p></section>`; host.querySelector('[data-back]').onclick = () => { open = null; renderSurveys(host); }; return; }

  const names = {};
  for (const q of d.questions) for (const o of [...(q.options ?? []), ...(q.extra ?? []), ...(q.then?.options ?? [])]) names[o.id] = `${o.icon ? o.icon + ' ' : ''}${o.label}`;
  for (const r of d.rows) Object.assign(names, r.names ?? {});
  const label = (id) => names[id] ?? id;
  const fast = (r) => r.secs != null && r.secs < d.min_secs;
  const grades = [...new Set(d.rows.map((r) => r.grade).filter(Boolean))].sort();
  const rows = d.rows.filter((r) => (filt.fast || !fast(r))
    && (!filt.grade || String(r.grade ?? '') === filt.grade) && (!filt.dev || devOf(r.device) === filt.dev));
  const nFast = d.rows.filter(fast).length;
  const faceQ = d.questions.find((q) => q.type === 'face');
  const faceOf = (r) => Number(r.answers?.[faceQ?.id]);
  const faces = faceQ ? rows.map(faceOf).filter((v) => v >= 1 && v <= 5) : [];
  const avg = (fs) => (fs.length ? (fs.reduce((a, b) => a + b, 0) / fs.length).toFixed(1) : '—');
  const texts = rows.filter((r) => r.text).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const bars = (pairs, n) => {
    const max = Math.max(1, ...pairs.map(([, c]) => c));
    return `<ul class="sv-bars">${pairs.map(([k, c]) => `<li><span class="k">${esc(k)}</span>
      <span class="sv-bar"><i style="width:${(100 * c / max).toFixed(1)}%"></i></span><b>${c}</b><small>${n ? Math.round(100 * c / n) : 0}%</small></li>`).join('')}</ul>`;
  };
  const count = (vals) => { const m = new Map(); vals.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]); };
  const seen = (from, id) => rows.filter((r) => (r.answers?._pool?.[from] ?? []).includes(id)).length;

  // 每日（區間超過 45 天就改每週）份數與平均好玩度
  const trend = (() => {
    if (!rows.length) return '<p class="tip">這段期間沒有人寫。</p>';
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const a = from ?? days[0], b = to ?? days[days.length - 1];
    const span = (Date.parse(b) - Date.parse(a)) / 864e5 + 1;
    const weekly = span > 45;
    const keyOf = (s) => { if (!weekly) return s; const x = new Date(s + 'T00:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };
    const buckets = new Map();
    for (let t = Date.parse(a + 'T00:00:00'); t <= Date.parse(b + 'T00:00:00'); t += 864e5) { const k = keyOf(ymd(new Date(t))); if (!buckets.has(k)) buckets.set(k, []); }
    rows.forEach((r) => { const k = keyOf(r.day); (buckets.get(k) ?? buckets.set(k, []).get(k)).push(r); });
    const list = [...buckets].sort((x, y) => x[0].localeCompare(y[0]));
    const max = Math.max(1, ...list.map(([, v]) => v.length));
    return `<p class="tip">${weekly ? '每週（週一開始）' : '每天'}幾份、平均好玩度。滑鼠移到柱子上看數字。</p>
      <div class="sv-trend">${list.map(([k, v]) => `<div class="col" title="${md(k)}${weekly ? ' 那週' : ''}：${v.length} 份，平均好玩度 ${avg(v.map(faceOf).filter((x) => x >= 1))}">
        <i style="height:${(100 * v.length / max).toFixed(1)}%"></i><span>${md(k)}</span></div>`).join('')}</div>`;
  })();

  const qHtml = d.questions.map((q) => {
    if (q.type === 'text') return '';
    const vals = rows.map((r) => r.answers?.[q.id]).filter((v) => v !== undefined && v !== null);
    let body = '';
    if (q.type === 'face') body = bars([5, 4, 3, 2, 1].map((v) => [FACE[v], vals.filter((x) => Number(x) === v).length]), vals.length);
    else if (q.type === 'pick') body = bars(count(q.multi ? vals.flat() : vals).map(([k, c]) => [label(k), c]), vals.length);
    else if (q.type === 'yesno') {
      const yes = vals.filter((v) => v === true || Array.isArray(v));
      body = bars([['有', yes.length], ['沒有', vals.filter((v) => v === false).length]], vals.length);
      const which = q.then ? count(yes.filter(Array.isArray).flat()) : [];
      if (which.length) {
        body += `<h4>${esc(q.then.q)}</h4>${q.then.from
          ? `<p class="tip">卡住率＝點這個的人 ÷ 有玩過它的人。</p>
             <div class="tablewrap"><table class="adm"><thead><tr><th>哪一個</th><th>點的人</th><th>玩過的人</th><th>卡住率</th></tr></thead><tbody>
             ${which.map(([k, c]) => { const n = seen(q.then.from, k); return `<tr><td>${esc(label(k))}</td><td class="num">${c}</td><td class="num">${n || '—'}</td><td class="num"><b>${n ? Math.round(100 * c / n) + '%' : '—'}</b></td></tr>`; }).join('')}
             </tbody></table></div>`
          : bars(which.map(([k, c]) => [label(k), c]), yes.length)}`;
      }
    }
    return `<details class="panel sv-q" open><summary><h3>${esc(q.q)}</h3><span class="tip">${vals.length} 人答</span></summary>${body || '<p class="tip">還沒有人答。</p>'}</details>`;
  }).join('');

  // 留言管理
  const byState = (k) => texts.filter((r) => r.state === k).length;
  const byTag = (k) => texts.filter((r) => (k === 'none' ? !r.tag : r.tag === k)).length;
  const q = mf.q.trim().toLowerCase();
  const msgs = texts.filter((r) => (!mf.state || r.state === mf.state)
    && (!mf.tag || (mf.tag === 'none' ? !r.tag : r.tag === mf.tag))
    && (!q || `${r.text} ${r.nickname} ${r.note ?? ''}`.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(msgs.length / PAGE));
  mf.page = Math.min(mf.page, pages - 1);
  const shown = msgs.slice(mf.page * PAGE, (mf.page + 1) * PAGE);
  const chip = (group, k, text, n) => `<button class="sv-chip ${mf[group] === k ? 'on' : ''}" data-mf="${group}" data-v="${k}">${text}<small>${n}</small></button>`;

  const st = STATUS[d.status] ?? null;
  host.innerHTML = `<section class="panel">
      <div class="sv-title"><button class="ghost small" data-back>← 所有問卷</button><h2>${esc(d.title)}</h2>
        <span class="tag">${esc(KIND[d.kind] ?? d.kind)}</span>${st ? `<span class="tag ${st[1]}">${st[0]}</span>` : ''}</div>
      <div class="sv-range">${[['all', '全部'], ['today', '今天'], ['7', '近 7 天'], ['30', '近 30 天'], ['month', '本月'], ['custom', '自訂']].map(([k, v]) =>
        `<button class="sv-chip ${rng.preset === k ? 'on' : ''}" data-rng="${k}">${v}</button>`).join('')}
        <span class="sv-custom" ${rng.preset === 'custom' ? '' : 'hidden'}><input type="date" data-from value="${esc(rng.from)}"> ～ <input type="date" data-to value="${esc(rng.to)}"></span>
        <span class="tip">${from || to ? `${md(from) || '一開始'} ～ ${md(to) || '今天'}（照最後送出那天）` : '全部期間'}</span></div>
      <div class="row sv-filt">
        <label>年級 <select data-f="grade"><option value="">全部</option>${grades.map((g) => `<option value="${g}">${g} 年級</option>`).join('')}</select></label>
        <label>裝置 <select data-f="dev"><option value="">全部</option>${Object.values(DEV).map((v) => `<option>${v}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-f="fast"> 也算送太快的</label>
        <span class="spacer"></span><button class="ghost small" data-csv>匯出 CSV（這個區間）</button></div>
      <div class="kpis"><div class="kpi"><b>${rows.length}</b><span>份</span></div>
        <div class="kpi"><b>${avg(faces)}</b><span>平均好玩度（5 最高）</span></div>
        <div class="kpi"><b>${texts.length}</b><span>有寫留言<small>（新的 ${byState('new')}）</small></span></div>
        <div class="kpi"><b>${nFast}</b><span>送太快（少於 ${d.min_secs} 秒）</span></div></div>
    </section>
    <section class="panel"><div class="head"><h3>每日份數</h3></div>${trend}</section>
    <section class="panel" id="sv-msgs"><div class="head"><h3>留言管理</h3></div>
      <div class="sv-chips"><span class="k">狀態</span>${chip('state', '', '全部', texts.length)}${Object.entries(STATE).map(([k, v]) => chip('state', k, v, byState(k))).join('')}</div>
      <div class="sv-chips"><span class="k">分類</span>${chip('tag', '', '全部', texts.length)}${chip('tag', 'none', '還沒分類', byTag('none'))}${Object.entries(TAG).map(([k, v]) => chip('tag', k, v, byTag(k))).join('')}</div>
      <div class="row sv-filt"><input type="search" data-q placeholder="搜尋留言、暱稱、備註" value="${esc(mf.q)}">
        <span class="spacer"></span>
        <span class="sv-bulk">勾選的 <select data-bulk><option value="">改成…</option>${Object.entries(STATE).map(([k, v]) => `<option value="state:${k}">狀態：${v}</option>`).join('')}
          ${Object.entries(TAG).map(([k, v]) => `<option value="tag:${k}">分類：${v}</option>`).join('')}<option value="tag:">分類：清掉</option></select></span></div>
      ${shown.length ? `<div class="tablewrap"><table class="adm sv-msg">
        <thead><tr><th><input type="checkbox" data-all aria-label="全選"></th><th>時間</th><th>孩子</th><th>留言</th><th>分類</th><th>狀態</th><th>備註</th></tr></thead>
        <tbody>${shown.map((r) => `<tr class="st-${r.state}" data-id="${esc(r.id)}">
          <td><input type="checkbox" data-pick></td>
          <td class="nowrap">${esc(hm(r.at))}${r.edits ? '<small>改過</small>' : ''}</td>
          <td><b>${esc(r.nickname)}</b><small>${esc(r.class_name || r.class || '')}${r.grade ? `・${r.grade} 年級` : ''}・${esc(devOf(r.device))}${faceQ && FACE[faceOf(r)] ? `・${esc(FACE[faceOf(r)])}` : ''}</small></td>
          <td class="sv-text">${esc(r.text)}</td>
          <td><select data-tag><option value="">還沒分類</option>${Object.entries(TAG).map(([k, v]) => `<option value="${k}" ${r.tag === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
          <td><select data-state>${Object.entries(STATE).map(([k, v]) => `<option value="${k}" ${r.state === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
          <td><input data-note value="${esc(r.note ?? '')}" placeholder="例如：已改第 0.61 版" maxlength="200"></td></tr>`).join('')}</tbody></table></div>
        ${pages > 1 ? `<div class="row sv-pager"><button class="ghost small" data-pg="-1" ${mf.page ? '' : 'disabled'}>上一頁</button><span>第 ${mf.page + 1} / ${pages} 頁・共 ${msgs.length} 則</span><button class="ghost small" data-pg="1" ${mf.page < pages - 1 ? '' : 'disabled'}>下一頁</button></div>` : ''}`
      : `<p class="tip">${texts.length ? '沒有符合的留言。' : '這段期間沒有人寫留言。'}</p>`}
    </section>
    ${qHtml}`;

  const again = () => paintOne(host);
  host.querySelector('[data-back]').onclick = () => { open = null; renderSurveys(host); };
  host.querySelectorAll('[data-rng]').forEach((b) => { b.onclick = () => { rng = { ...rng, preset: b.dataset.rng }; mf.page = 0; again(); }; });
  const f = host.querySelector('[data-from]'), t = host.querySelector('[data-to]');
  f.onchange = t.onchange = () => { rng = { preset: 'custom', from: f.value, to: t.value }; mf.page = 0; again(); };
  host.querySelector('[data-f="grade"]').value = filt.grade;
  host.querySelector('[data-f="dev"]').value = filt.dev;
  host.querySelector('[data-f="fast"]').checked = filt.fast;
  host.querySelectorAll('[data-f]').forEach((el) => {
    el.onchange = () => { filt = { ...filt, [el.dataset.f]: el.type === 'checkbox' ? el.checked : el.value }; again(); };
  });
  host.querySelector('[data-csv]').onclick = () => csv(d, rows, label, from, to);
  host.querySelectorAll('[data-mf]').forEach((b) => { b.onclick = () => { mf = { ...mf, [b.dataset.mf]: b.dataset.v, page: 0 }; again(); }; });
  const qs = host.querySelector('[data-q]');
  qs.onkeydown = (e) => { if (e.key === 'Enter') { mf = { ...mf, q: qs.value, page: 0 }; again(); } };
  qs.onsearch = () => { mf = { ...mf, q: qs.value, page: 0 }; again(); };
  host.querySelectorAll('[data-pg]').forEach((b) => { b.onclick = () => { mf.page += Number(b.dataset.pg); again(); host.querySelector('#sv-msgs')?.scrollIntoView(); }; });

  // 一筆一筆改：當場存，不重畫（免得正在打備註被洗掉）
  const save = async (ids, tag, state, note) => {
    try {
      await auth.survey.mark(open, ids, tag, state, note);
      for (const r of d.rows) if (ids.includes(r.id)) {
        if (tag !== null) r.tag = tag || null;
        if (state !== null) r.state = state;
        if (note !== null) r.note = note;
      }
      return true;
    } catch (e) { alert(e.message); return false; }
  };
  host.querySelectorAll('.sv-msg tbody tr').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('[data-tag]').onchange = async (e) => {
      // 分類了就當作看過
      const st = tr.querySelector('[data-state]');
      const next = st.value === 'new' ? 'seen' : null;
      if (await save([id], e.target.value, next, null) && next) { st.value = next; tr.className = `st-${next}`; }
    };
    tr.querySelector('[data-state]').onchange = async (e) => { if (await save([id], null, e.target.value, null)) tr.className = `st-${e.target.value}`; };
    const note = tr.querySelector('[data-note]');
    note.onchange = () => save([id], null, null, note.value);
  });
  const all = host.querySelector('[data-all]');
  if (all) all.onchange = () => host.querySelectorAll('[data-pick]').forEach((c) => { c.checked = all.checked; });
  host.querySelector('[data-bulk]').onchange = async (e) => {
    const v = e.target.value; e.target.value = '';
    const ids = [...host.querySelectorAll('[data-pick]:checked')].map((c) => c.closest('tr').dataset.id);
    if (!v || !ids.length) { if (v) alert('先勾選要改的留言'); return; }
    const [k, val] = v.split(':');
    if (await save(ids, k === 'tag' ? val : null, k === 'state' ? val : null, null)) again();
  };
}

function csv(d, rows, label, from, to) {
  const qs = d.questions;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const val = (q, r) => {
    if (q.type === 'text') return r.text ?? '';
    const v = r.answers?.[q.id];
    if (v === undefined || v === null) return '';
    if (q.type === 'face') return FACE[v] ?? v;
    if (q.type === 'yesno') return v === false ? '沒有' : Array.isArray(v) ? `有：${v.map(label).join('、')}` : '有';
    return Array.isArray(v) ? v.map(label).join('、') : label(v);
  };
  const head = ['日期', '時間', '暱稱', '班級', '年級', '裝置', '秒數', ...qs.map((q) => q.q), '分類', '狀態', '備註'];
  const lines = [head, ...rows.map((r) => [r.day, hm(r.at), r.nickname, r.class_name || r.class, r.grade ?? '', devOf(r.device), r.secs ?? '',
    ...qs.map((q) => val(q, r)), TAG[r.tag] ?? '', STATE[r.state] ?? '', r.note ?? ''])];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${d.code}_${from || '開始'}_${to || ymd(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
