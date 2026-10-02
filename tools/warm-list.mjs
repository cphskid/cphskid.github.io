// 產生 data/warm.json：img/ 底下所有圖的清單，給 js/warm.js 在背景預熱用。
//
//   node tools/warm-list.mjs
//
// 新增或刪掉圖以後跑一次再 commit。忘了跑也不會壞：新的圖只是不會被預先抓，點開時才載入。
// （img/ts/ 是發佈時才從私有 repo 放進來的小兵圖，不列。）
import { readdirSync, statSync, writeFileSync } from 'node:fs';
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
