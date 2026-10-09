// 讀取計時：網址加 ?perf=1 打開（記在這台裝置上，進島嶼開拓者也會顯示；?perf=0 關掉）。
// 畫面右下角列出「從開網頁到每個階段」幾秒，和圖片從哪裡來（網路／存在裝置裡）。
// 島嶼開拓者那邊是 src/perf.ts，用同一個開關。
const KEY = 'timepark-perf';

export const PERF = (() => {
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q === '0') localStorage.removeItem(KEY);
    else if (q !== null) localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch { return false; }
})();

const marks = [];
let box = null, ticks = 0;

// 記一個階段；同一個名字再記一次（例如第二次打開寵物島）會在後面加「（第 2 次）」
export function mark(label) {
  if (!PERF) return;
  const n = marks.filter(([l]) => l.startsWith(label)).length;
  marks.push([n ? `${label}（第 ${n + 1} 次）` : label, performance.now()]);
  draw();
}
// 從某個時間點起算花了幾秒（例如點寵物島到掀開）
export function span(label, from) {
  if (!PERF) return;
  marks.push([`${label}：花 ${((performance.now() - from) / 1000).toFixed(1)} 秒`, performance.now()]);
  draw();
}

function draw() {
  if (!box) {
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:99999;max-width:70vw;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.72);color:#fff;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(box);
    const t = setInterval(() => { draw(); if (++ticks > 90) clearInterval(t); }, 1000);
  }
  const imgs = performance.getEntriesByType('resource').filter((e) => /\.(webp|png|jpe?g)(\?|$)/.test(e.name));
  let net = 0, netKB = 0, sw = 0, http = 0;
  for (const e of imgs) {
    if (e.transferSize > 0) { net++; netKB += e.transferSize / 1024; }
    else if (e.workerStart > 0) sw++;
    else http++;
  }
  const s = (ms) => (ms / 1000).toFixed(1) + ' 秒';
  box.textContent = [
    ...marks.slice(-12).map(([l, t]) => `${s(t)}  ${l}`),
    `圖 ${imgs.length} 張：網路 ${net} 張 ${Math.round(netKB)}KB、裝置裡 ${sw} 張、瀏覽器暫存 ${http} 張`,
    `存進裝置：${'serviceWorker' in navigator && navigator.serviceWorker.controller ? '有' : '還沒'}`,
  ].join('\n');
}
