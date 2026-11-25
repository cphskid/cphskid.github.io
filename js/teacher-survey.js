// 後台 → 管理 → 問卷（2026-11-25，supabase/park_survey.sql）。只有管理員看（Chuck 決定老師不看）。
// 每份問卷一樣的畫面：選問卷 → 份數、平均好玩度、每一題的長條、卡住率、文字留言；可篩年級／裝置、匯出 CSV。
// 統計在這裡算（park_survey_admin 回每一份作答），以後題目怎麼變都照題型畫。
import * as auth from './auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const FACE = { 5: '😆 超好玩', 4: '🙂 好玩', 3: '😐 普通', 2: '😕 有點無聊', 1: '😫 不好玩' };
const DEV = { phone: '手機', tablet: '平板', desktop: '電腦' };
const devOf = (d) => DEV[String(d || '').split('-')[0]] ?? '—';

let pick = '';
let filt = { grade: '', dev: '', fast: false };

export async function renderSurveys(host) {
  host.innerHTML = '<section class="panel"><p class="lead">讀取中…</p></section>';
  let list;
  try { list = await auth.survey.list(); }
  catch (e) { host.innerHTML = `<section class="panel"><p class="tip">${esc(e.message)}</p></section>`; return; }
  if (!list.length) { host.innerHTML = '<section class="panel"><div class="empty small"><p>還沒有問卷。</p></div></section>'; return; }
  if (!list.some((s) => s.code === pick)) pick = list[0].code;
  host.innerHTML = `<section class="panel">
      <div class="head"><h2>孩子的問卷</h2>
        <select data-sv class="auto">${list.map((s) => `<option value="${esc(s.code)}">${esc(s.title)}（${esc(s.facility_name)}・${s.answers} 份）</option>`).join('')}</select></div>
      <p class="lead">孩子在遊戲裡寫的問卷（孩子畫面不叫問卷，例如實驗室的「留言本」）。每份第一次寫完給時光幣、一個帳號只算一份，再寫是改答案。
        送得太快的（例如亂點一通）照樣給幣，但統計預設不算。開新問卷請告訴 Claude，題目、獎勵、放哪裡都是設定，不用改程式。</p>
    </section><div id="sv-body"><section class="panel"><p class="lead">讀取中…</p></section></div>`;
  const sel = host.querySelector('[data-sv]');
  sel.value = pick;
  sel.onchange = () => { pick = sel.value; paint(host.querySelector('#sv-body')); };
  await paint(host.querySelector('#sv-body'));
}

async function paint(box) {
  let d;
  try { d = await auth.survey.admin(pick); }
  catch (e) { box.innerHTML = `<section class="panel"><p class="tip">${esc(e.message)}</p></section>`; return; }
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
  const faces = faceQ ? rows.map((r) => Number(r.answers?.[faceQ.id])).filter((v) => v >= 1 && v <= 5) : [];
  const avg = faces.length ? (faces.reduce((a, b) => a + b, 0) / faces.length).toFixed(1) : '—';
  const texts = rows.filter((r) => r.text);

  const bars = (pairs, n, extra = () => '') => {
    const max = Math.max(1, ...pairs.map(([, c]) => c));
    return `<ul class="sv-bars">${pairs.map(([k, c]) => `<li><span class="k">${esc(k)}</span>
      <span class="sv-bar"><i style="width:${(100 * c / max).toFixed(1)}%"></i></span><b>${c}</b><small>${n ? Math.round(100 * c / n) : 0}%${extra(k)}</small></li>`).join('')}</ul>`;
  };
  const count = (vals) => { const m = new Map(); vals.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]); };
  // 有這個選項的人（遊戲給的選項，例如玩過的實驗）：卡住率的分母
  const seen = (from, id) => rows.filter((r) => (r.answers?._pool?.[from] ?? []).includes(id)).length;

  const qHtml = d.questions.map((q) => {
    const vals = rows.map((r) => r.answers?.[q.id]).filter((v) => v !== undefined && v !== null);
    if (q.type === 'text') return '';
    let body = '';
    if (q.type === 'face') body = bars([5, 4, 3, 2, 1].map((v) => [FACE[v], vals.filter((x) => Number(x) === v).length]), vals.length);
    else if (q.type === 'pick') {
      const flat = q.multi ? vals.flat() : vals;
      body = bars(count(flat).map(([k, c]) => [label(k), c]), vals.length);
    } else if (q.type === 'yesno') {
      const yes = vals.filter((v) => v === true || Array.isArray(v));
      body = bars([['有', yes.length], ['沒有', vals.filter((v) => v === false).length]], vals.length);
      if (q.then) {
        const which = count(yes.filter(Array.isArray).flat());
        if (which.length) {
          body += `<h4>${esc(q.then.q)}</h4>${q.then.from
            ? `<p class="tip">卡住率＝點這個的人 ÷ 有玩過它的人（只算有填這題的）。</p>
               <div class="tablewrap"><table class="adm"><thead><tr><th>哪一個</th><th>點的人</th><th>玩過的人</th><th>卡住率</th></tr></thead><tbody>
               ${which.map(([k, c]) => { const n = seen(q.then.from, k); return `<tr><td>${esc(label(k))}</td><td class="num">${c}</td><td class="num">${n || '—'}</td><td class="num"><b>${n ? Math.round(100 * c / n) + '%' : '—'}</b></td></tr>`; }).join('')}
               </tbody></table></div>`
            : bars(which.map(([k, c]) => [label(k), c]), yes.length)}`;
        }
      }
    }
    return `<section class="panel"><div class="head"><h3>${esc(q.q)}</h3><span class="tip">${vals.length} 人答</span></div>${body || '<p class="tip">還沒有人答。</p>'}</section>`;
  }).join('');

  box.innerHTML = `<section class="panel">
      <div class="kpis"><div class="kpi"><b>${rows.length}</b><span>份（篩選後）</span></div>
        <div class="kpi"><b>${avg}</b><span>平均好玩度（5 最高）</span></div>
        <div class="kpi"><b>${texts.length}</b><span>有寫留言</span></div>
        <div class="kpi"><b>${nFast}</b><span>送太快（少於 ${d.min_secs} 秒）</span></div></div>
      <div class="row sv-filt">
        <label>年級 <select data-f="grade"><option value="">全部</option>${grades.map((g) => `<option value="${g}">${g} 年級</option>`).join('')}</select></label>
        <label>裝置 <select data-f="dev"><option value="">全部</option>${Object.values(DEV).map((v) => `<option>${v}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-f="fast"> 也算送太快的</label>
        <span class="spacer"></span><button class="ghost small" data-csv>匯出 CSV</button></div>
    </section>
    ${qHtml}
    <section class="panel"><div class="head"><h3>文字留言（${texts.length}）</h3></div>
      ${texts.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>時間</th><th>孩子</th><th>好玩度</th><th>留言</th></tr></thead><tbody>
        ${texts.map((r) => `<tr><td class="nowrap">${esc(day(r.at))}</td>
          <td><b>${esc(r.nickname)}</b><small>${esc(r.class_name || r.class || '')}${r.grade ? `・${r.grade} 年級` : ''}・${esc(devOf(r.device))}</small></td>
          <td class="nowrap">${faceQ ? esc(FACE[r.answers?.[faceQ.id]] ?? '—') : ''}</td><td class="sv-text">${esc(r.text)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="tip">還沒有人寫留言。</p>'}</section>`;

  box.querySelector('[data-f="grade"]').value = filt.grade;
  box.querySelector('[data-f="dev"]').value = filt.dev;
  box.querySelector('[data-f="fast"]').checked = filt.fast;
  box.querySelectorAll('[data-f]').forEach((el) => {
    el.onchange = () => { filt = { ...filt, [el.dataset.f]: el.type === 'checkbox' ? el.checked : el.value }; paint(box); };
  });
  box.querySelector('[data-csv]').onclick = () => csv(d, rows, label);
}

function csv(d, rows, label) {
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
  const head = ['時間', '暱稱', '班級', '年級', '裝置', '秒數', ...qs.map((q) => q.q)];
  const lines = [head, ...rows.map((r) => [day(r.at), r.nickname, r.class_name || r.class, r.grade ?? '', devOf(r.device), r.secs ?? '', ...qs.map((q) => val(q, r))])];
  const blob = new Blob(['﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${d.code}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
