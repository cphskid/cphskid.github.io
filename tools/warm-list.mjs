// 產生兩份清單：
//   data/warm.json       img/ 底下所有圖，給 js/warm.js 在背景預熱用
//   data/sw-manifest.json img/、audio/ 每個檔案的指紋，給 sw.js 判斷存在裝置裡的圖是不是最新的
//
//   node tools/warm-list.mjs
//
// 推到 dev 時 GitHub 會自動跑一次（.github/workflows/manifest.yml），換了圖會自動 commit 新清單。
// 忘了跑也不會壞：新的圖不會被預先抓、點開時才載入；換掉的圖在自動清單更新前會先看到舊的。
// （img/ts/ 是發佈時才從私有 repo 放進來的小兵圖，不列。）
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = [];
(function walk(dir) {
  for (const n of readdirSync(join(root, dir)).sort()) {
    const p = `${dir}/${n}`;
    if (statSync(join(root, p)).isDirectory()) { if (p !== 'img/ts') walk(p); }
    else if (/\.(webp|png|jpe?g)$/.test(n)) out.push(p);
  }
})('img');
writeFileSync(join(root, 'data/warm.json'), JSON.stringify(out, null, 0).replace(/","/g, '",\n"') + '\n');
console.log(`data/warm.json：${out.length} 張圖`);

const files = {};
const hash = (dir, skip) => {
  for (const n of readdirSync(join(root, dir)).sort()) {
    const p = `${dir}/${n}`;
    if (statSync(join(root, p)).isDirectory()) { if (p !== skip) hash(p, skip); }
    else if (!n.startsWith('.')) files[p] = createHash('md5').update(readFileSync(join(root, p))).digest('hex').slice(0, 12);
  }
};
hash('img', 'img/ts');
hash('audio');
const v = createHash('md5').update(JSON.stringify(files)).digest('hex').slice(0, 12);
writeFileSync(join(root, 'data/sw-manifest.json'), JSON.stringify({ v, files }) + '\n');
console.log(`data/sw-manifest.json：${Object.keys(files).length} 個檔案`);
