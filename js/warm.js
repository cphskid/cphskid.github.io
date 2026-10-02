// 圖片預熱：不讓畫面「掉圖慢半拍」。
//
// 1. settle(imgs)：開門前等首屏的圖都抓好、解碼好（最多等 cap 毫秒，網路很慢也不會卡在門口）。
// 2. warm(...)：畫面安靜下來以後，在背景把「下一步可能會用到」的圖先抓進瀏覽器快取，
//    點開島的介紹卡、護照、寵物島時圖已經在手上，不用再等網路。
//    一次只抓幾張、閒下來才抓，不跟眼前的畫面搶頻寬。
// 圖的清單在 data/warm.json（node tools/warm-list.mjs 產生）。

const ready = (img) => (img.decode ? img.decode() : new Promise((ok, no) => {
  if (img.complete) return img.naturalWidth ? ok() : no();
  img.onload = ok; img.onerror = no;
})).catch(() => {});

// 等這些圖（<img> 元素或網址）都好了；最多等 cap 毫秒
export function settle(items, cap = 4000) {
  const all = items.map((x) => {
    if (typeof x !== 'string') return ready(x);
    const im = new Image();
    im.src = x;
    return ready(im);
  });
  return Promise.race([Promise.all(all), new Promise((ok) => setTimeout(ok, cap))]);
}

let list;
const manifest = () => (list ??= fetch('data/warm.json').then((r) => (r.ok ? r.json() : [])).catch(() => []));

const queued = new Set();
const queue = [];
let running = 0;
const MAX = 3;
const later = window.requestIdleCallback
  ? (fn) => requestIdleCallback(fn, { timeout: 1500 })
  : (fn) => setTimeout(fn, 120);

function pump() {
  while (running < MAX && queue.length) {
    const src = queue.shift();
    running++;
    later(() => {
      const im = new Image();
      im.decoding = 'async';
      im.src = src;
      ready(im).then(() => { running--; pump(); });
    });
  }
}

// prefixes：'img/ui/' 這種資料夾開頭，或完整的檔名；排在前面的先抓
export async function warm(...prefixes) {
  const all = await manifest();
  for (const pre of prefixes) {
    for (const src of all) {
      if (!src.startsWith(pre) || queued.has(src)) continue;
      queued.add(src);
      queue.push(src);
    }
  }
  pump();
}
