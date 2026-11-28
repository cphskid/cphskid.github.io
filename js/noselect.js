// 樂園介面設計原則：遊戲畫面不能被長按／右鍵反白、選取、叫出系統選單（2026-11-28 Chuck）
// 搭配 css/noselect.css。CSS 擋住大部分；這裡補：電腦右鍵選單、Android 長按選單、圖片拖曳、
// iOS 偶爾還是選得起來的情況（一出現選取就清掉）。輸入框、可編輯區、.can-select 不擋。
(function () {
  if (window.__noSelect) return; window.__noSelect = 1;
  var KEEP = 'input:not([type=button]):not([type=submit]):not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]:not([contenteditable=false]),.can-select,.tp';
  function el(n) { return n && (n.nodeType === 1 ? n : n.parentElement); }
  function keep(n) { n = el(n); return !!(n && n.closest && n.closest(KEEP)); }
  function stop(e) { if (!keep(e.target)) e.preventDefault(); }
  document.addEventListener('contextmenu', stop, true);
  document.addEventListener('selectstart', stop, true);
  document.addEventListener('dragstart', function (e) {
    var t = el(e.target);
    if (t && t.closest && t.closest('[draggable=true]')) return; // 自己做的拖放照常
    stop(e);
  }, true);
  document.addEventListener('selectionchange', function () {
    var s = document.getSelection && document.getSelection();
    if (!s || s.isCollapsed || keep(document.activeElement) || keep(s.anchorNode)) return;
    s.removeAllRanges();
  });
})();
