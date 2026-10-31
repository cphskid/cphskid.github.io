// 小對話框（.wallet：爸媽任務、新手手冊、時光幣、排行）內容太長時在框裡捲動。
// 關閉鈕 .x 掛在框外角落，框本身不能裁切，所以把 .x 以外的內容包進 .wscroll，由它捲。
export function wrapWallet(layer) {
  const w = layer.querySelector(':scope > .wallet');
  if (!w || w.querySelector(':scope > .wscroll')) return;
  const box = document.createElement('div');
  box.className = 'wscroll';
  [...w.childNodes].forEach((n) => { if (!n.classList?.contains('x')) box.append(n); });
  w.append(box);
}
