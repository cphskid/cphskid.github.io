// 2026-11-20 手機轉向後下方按鈕點不到（Chuck：玩完守護異世界橫拿，回樂園轉直拿，功能列和關閉鈕沒反應）
// iPhone Safari 的老毛病：整頁不能捲（body overflow:hidden）時，轉向後 position:fixed 那層的「可點範圍」
// 有時還停在橫拿的大小（矮矮一條），畫面看起來正常，但下半部的按鈕點下去沒反應，要捲一下才會好，偏偏樂園捲不動。
// 做法：轉向（寬度變了）就
//   1. 把真正的畫面高度寫進 --app-h，#world、#ui 用這個高度（尺寸變了，Safari 一定得重算那層）
//   2. 整頁捲回最上面（橫拿時網址列收起可能留下一點捲動）
//   3. 讓 #ui 換一次圖層，逼 Safari 重建點擊範圍
// iOS 轉向後尺寸會分幾次才到位，所以轉完再補做幾次。
(() => {
  const root = document.documentElement;
  let lastW = 0, lastH = 0, timers = [];
  function sync(force) {
    const vv = window.visualViewport;
    // 兩指放大中不要動（那時 visualViewport 比較小是正常的）
    if (vv && vv.scale > 1.01) return;
    const w = innerWidth, h = innerHeight;   // 用 innerHeight：跳出鍵盤時它不會變矮，介面不跟著縮
    if (!force && w === lastW && h === lastH) return;
    const turned = lastW && w !== lastW;
    lastW = w; lastH = h;
    root.style.setProperty('--app-h', h + 'px');
    if (scrollX || scrollY) scrollTo(0, 0);
    if (turned || force) {
      const ui = document.getElementById('ui');
      if (ui) {
        ui.style.transform = 'translateZ(0)';
        requestAnimationFrame(() => requestAnimationFrame(() => { ui.style.transform = ''; }));
      }
    }
  }
  function burst() {
    timers.forEach(clearTimeout);
    sync();
    timers = [80, 300, 700, 1200].map((ms, i, a) => setTimeout(() => sync(i === a.length - 1), ms));
  }
  addEventListener('resize', burst);
  addEventListener('orientationchange', burst);
  window.visualViewport?.addEventListener('resize', () => sync());
  // 從別的遊戲按上一頁回來（整頁從快取復原）也重算一次
  addEventListener('pageshow', () => sync(true));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => sync());
  else sync();
})();
