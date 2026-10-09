// 版號與更新說明（2026-10-09，照守護異世界 0.18.0 那套）。
//
// 內容在 data/changelog.json，第一筆就是目前版號。測試站（/dev/）另外讀正式站那一份，
// 兩邊一比，測試站多出來的版本就是「待發布」，發版時不用有人另外記一張清單。
//
// 用法（樂園、老師後台都用這支）：
//   <b data-park-version data-prefix="測試站 "></b>  → 讀到版號後填成「測試站 v0.11」
//   <button data-park-changelog>                     → 點了打開更新說明
//   ParkChangelog.open() / ParkChangelog.ready（Promise，給版號字串）
(function () {
  if (window.ParkChangelog) return;

  const SRC = (document.currentScript && document.currentScript.src) || location.href;
  const BASE = SRC.replace(/js\/changelog\.js.*$/, '');
  const IS_DEV = /\/dev\/$/.test(new URL(BASE, location.href).pathname);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (v) => String(v).replace(/\.0$/, '');
  function cmp(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  }
  async function load(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      return (await r.json()).versions || null;
    } catch { return null; }
  }

  const mine = load(new URL('data/changelog.json', BASE).href);
  // 正式站還沒有 changelog.json（還沒上線這個功能）時當作 0：測試站做過的全部待發布
  const prod = IS_DEV ? load(new URL('../data/changelog.json', BASE).href).then((v) => (v && v[0] ? v[0].version : '0.0.0')) : null;
  const ready = mine.then((v) => (v && v[0] ? v[0].version : ''));

  function paint(v) {
    if (!v) return;
    document.querySelectorAll('[data-park-version]').forEach((el) => { el.textContent = (el.dataset.prefix || '') + 'v' + short(v); });
  }
  ready.then(paint);
  document.addEventListener('DOMContentLoaded', () => ready.then(paint));
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-park-changelog]');
    if (t) { e.preventDefault(); open(); }
  });

  const CSS = `
.pcl-veil{position:fixed;inset:0;z-index:9002;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(20,30,50,.55)}
.pcl-box{width:min(440px,100%);max-height:86vh;display:flex;flex-direction:column;gap:10px;padding:16px;background:#fff4dc;border:3px solid #6b3f1f;border-radius:18px;box-shadow:0 5px 0 #6b3f1f,0 14px 26px rgba(0,0,0,.3);font:500 15px/1.5 "Noto Sans TC",system-ui,sans-serif;color:#3a2412;text-align:left}
.pcl-box h2{margin:0;text-align:center;font:900 20px/1.2 "Noto Sans TC",system-ui,sans-serif}
.pcl-list{overflow-y:auto;display:flex;flex-direction:column;gap:12px;min-height:0;padding-right:2px}
.pcl-list h3{margin:4px 0 0;font:900 15px/1.3 "Noto Sans TC",system-ui,sans-serif;color:#a0601c}
.pcl-list h3 small{font-weight:500;font-size:13px;color:#8a6a4a;margin-left:8px}
.pcl-pending{display:flex;flex-direction:column;gap:10px;padding:10px;border:2px solid #e2553f;border-radius:12px;background:#fff}
.pcl-head b{color:#a0601c;margin-right:4px}
.pcl-head small{color:#8a6a4a;margin-left:8px;font-size:13px}
.pcl-ver ul{margin:4px 0 0;padding-left:20px}
.pcl-ver li{margin:2px 0}
.pcl-close{align-self:center;min-width:120px;padding:9px 18px;border:3px solid #6b3f1f;border-radius:999px;background:#ffe9bf;box-shadow:0 3px 0 #6b3f1f;font:900 16px/1 "Noto Sans TC",system-ui,sans-serif;color:#6b3f1f;cursor:pointer}
`;
  let styled = false;
  const ver = (e) => `<div class="pcl-ver"><div class="pcl-head"><b>v${esc(short(e.version))}</b> ${esc(e.title)}<small>${esc(e.date)}</small></div>`
    + `<ul>${(e.items || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;

  async function open() {
    if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styled = true; }
    const veil = document.createElement('div');
    veil.className = 'pcl-veil';
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');
    veil.innerHTML = '<div class="pcl-box"><h2>更新說明</h2><div class="pcl-list"><p>讀取中…</p></div><button class="pcl-close" type="button">關閉</button></div>';
    const close = () => { veil.remove(); removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('.pcl-close')) close(); });
    addEventListener('keydown', onKey);
    document.body.appendChild(veil);

    const list = veil.querySelector('.pcl-list');
    const [all, top] = await Promise.all([mine, prod]);
    if (!all) { list.innerHTML = '<p>讀不到更新說明，等一下再試試看。</p>'; return; }
    let html = '';
    let released = all;
    if (IS_DEV) {
      const pending = all.filter((e) => cmp(e.version, top) > 0);
      released = all.filter((e) => !pending.includes(e));
      const now = top === '0.0.0' ? '正式站還沒有版號' : `正式站目前是 v${esc(short(top))}`;
      html += `<section class="pcl-pending"><h3>待發布<small>${now}</small></h3>`
        + (pending.length ? pending.map(ver).join('') : '<p>測試站跟正式站一樣，沒有待發布的東西。</p>') + '</section>';
      if (released.length) html += '<h3>已經在正式站</h3>';
    }
    html += released.map(ver).join('');
    list.innerHTML = html;
  }

  window.ParkChangelog = { open, ready, IS_DEV };
})();
