// 2026-10-31 底部功能列放不下時自動收進「更多」（iPhone 15 Plus 430 寬、SE 375 寬都會被切掉）
// 做法：按鈕留在 #dock 裡（各自的程式照舊控制 hidden、徽章），放不下的加 .ovf 藏起來；
// 「更多」打開的抽屜放替身按鈕，點了就按原本那顆。照介面設計原則：圖＋字一起，不准只剩圖示。
(() => {
  const dock = document.getElementById('dock');
  if (!dock) return;
  // 數字小＝比較重要、最後才收（顯示順序還是照 HTML 的順序）
  const PRIO = { 'guide-btn': 1, 'task-btn': 1, 'pass-btn': 2, 'shop-btn': 3, 'wear-btn': 4, 'pet-btn': 5, 'quiz-btn': 6, 'rank-btn': 7, 'parent-btn': 8 };
  const btns = [...dock.querySelectorAll(':scope>button')];

  const more = document.createElement('button');
  more.type = 'button';
  more.id = 'more-btn';
  more.hidden = true;
  more.setAttribute('aria-label', '更多功能');
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = '<span class="more-ic" aria-hidden="true"><i></i><i></i><i></i></span><b>更多</b><i class="dot" hidden></i>';
  dock.append(more);

  const sheet = document.createElement('div');
  sheet.id = 'dock-more';
  sheet.hidden = true;
  sheet.setAttribute('role', 'menu');
  dock.parentNode.insertBefore(sheet, dock.nextSibling);

  function layout() {
    btns.forEach((b) => b.classList.remove('ovf'));
    const vis = btns.filter((b) => !b.hidden && getComputedStyle(b).display !== 'none');
    let over = [];
    if (vis.length) {
      const cs = getComputedStyle(dock);
      const gap = parseFloat(cs.columnGap) || 0;
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const bw = vis[0].getBoundingClientRect().width;
      const room = document.documentElement.clientWidth - 16 - pad;
      const fit = Math.max(2, Math.floor((room + gap) / (bw + gap)));
      if (vis.length > fit) {
        const keep = new Set([...vis].sort((a, b) => (PRIO[a.id] || 9) - (PRIO[b.id] || 9)).slice(0, fit - 1));
        over = vis.filter((b) => !keep.has(b));
        over.forEach((b) => b.classList.add('ovf'));
      }
    }
    more.hidden = !over.length;
    if (!over.length) close();
    syncMore(over);
  }

  // 收進去的按鈕有紅點／徽章或新手箭頭，「更多」也要看得出來
  function syncMore(over = btns.filter((b) => b.classList.contains('ovf'))) {
    const flag = over.some((b) => [...b.querySelectorAll('.dot,.badge')].some((d) => !d.hidden && d.textContent !== '✓'));
    more.querySelector('.dot').hidden = !flag;
    more.classList.toggle('starter-target', over.some((b) => b.classList.contains('starter-target')));
    if (!sheet.hidden) fill(over);
  }

  function fill(over) {
    sheet.replaceChildren(...over.map((b) => {
      const c = b.cloneNode(true);
      c.removeAttribute('id');
      c.classList.remove('ovf');
      c.hidden = false;
      c.setAttribute('role', 'menuitem');
      c.dataset.for = b.id;
      c.addEventListener('click', () => { close(); b.click(); });
      return c;
    }));
  }

  function open() {
    fill(btns.filter((b) => b.classList.contains('ovf')));
    sheet.hidden = false;
    // 抽屜右邊對齊功能列右邊，小三角對準「更多」；一排最多 4 顆
    const d = dock.getBoundingClientRect(), m = more.getBoundingClientRect(), w = document.documentElement.clientWidth;
    const right = Math.max(8, w - d.right);
    sheet.style.right = right + 'px';
    sheet.style.setProperty('--tip', Math.max(12, w - right - (m.left + m.width / 2) - 9) + 'px');
    sheet.style.setProperty('--cols', Math.min(4, sheet.children.length));
    more.setAttribute('aria-expanded', 'true');
    more.classList.add('on');
  }
  function close() {
    sheet.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    more.classList.remove('on');
  }
  more.addEventListener('click', (e) => { e.stopPropagation(); sheet.hidden ? open() : close(); });
  document.addEventListener('pointerdown', (e) => { if (!sheet.hidden && !sheet.contains(e.target) && !more.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  let t = 0;
  const soon = () => { cancelAnimationFrame(t); t = requestAnimationFrame(layout); };
  const noOvf = (v) => (v || '').split(/\s+/).filter((c) => c && c !== 'ovf').sort().join(' ');
  const inBadge = (n) => (n.nodeType === 1 ? n : n.parentNode)?.closest?.('.dot,.badge');
  new MutationObserver((list) => {
    // 自己加減 .ovf、「更多」的狀態不算；只有徽章、紅點變了就同步「更多」，其他才重排
    list = list.filter((m) => m.target !== more && !more.contains(m.target) && !(m.attributeName === 'class' && noOvf(m.oldValue) === noOvf(m.target.className)));
    if (!list.length) return;
    if (list.every((m) => inBadge(m.target))) syncMore();
    else soon();
  }).observe(dock, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'data-state'], attributeOldValue: true });
  new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['data-starter', 'data-scene'] });
  addEventListener('resize', soon);
  addEventListener('orientationchange', soon);
  soon();
})();
