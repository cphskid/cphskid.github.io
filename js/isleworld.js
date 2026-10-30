// 寵物島 2.0 的地圖（規劃 doc「寵物島 2.0 通盤規劃」A 期）：28×28 格的菱形平台。
//
// 座標兩種：格子 (i, j)（i 往右下、j 往左下，(0,0) 是最上面那格）；島上的比例 x、y（0～1，跟以前一樣）。
// 底圖 img/pet/land2/<風格>.webp 已經對齊格子（產圖、對齊、遮罩：/mnt/project-files/art/pet-island2/v2/）。
// 擺設存成 { v: 2, items: [[id, i, j, f], …] }：(i, j) 是佔的格子裡最上面那格，f＝左右翻面（翻面時佔地 i、j 對調）。
// pet.js（自己的島，會動）和 isle.js（參觀別人的島，不會動）共用這裡畫圖、算能不能擺、找路。

export const GW = 2640, GH = 1448, N = 28, CW = 90, CH = 45;
const TX = 1320, TY = 60;                  // 最上面那格的頂點
export const FURN_MAX = 60, BUILD_MAX = 150;

// 格子：0 島外、1 草地沙灘（可以擺、可以走）、2 池塘、3 海
const MASK = [
  '0001111111111111111111110000', '0111111111111111111111111100', '0110222211111111111111111110', '0102222221111111111111111110',
  '1022222221111111111111111110', '1122222221111111111111111111', '1122222221111111111111111111', '1122222221111111111111111111',
  '1112222211111111111111111111', '1111111111111111111111111111', '1111111111111111111111111111', '1111111111111111111111111111',
  '1111111111111111111111111111', '1111111111111111111111111111', '1111111111111111111111111111', '1111111111111111111111111111',
  '0111111111111111111111111111', '0111111111111111111111111111', '0111111111111111111111111111', '0111111111111111111111111111',
  '0111111111111111111111111111', '0111111111111111111111111111', '0111111111111111111111111111', '0111111111111111111111111111',
  '0311111111111111111111111110', '0031111111111111111111111110', '0033111111111111111111111110', '0003333311111111111111111000',
];
export const ground = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? '0' : MASK[j][i]);
// 池塘（給游泳用的橢圓，島上比例）
export const LAKE = { x: .5012, y: .2164, rx: .1023, ry: .0855 };

export const landSrc = (theme) => `img/pet/land2/${theme || 'spring'}.webp`;
export const landThumb = (theme) => `img/pet/land2/s-${theme || 'spring'}.webp`;

// 島上固定的樹（後面兩條邊），照風格換樹種；樹的格子不能擺東西、不能走
const TREE_SPOTS = [[10, 1], [14, 0], [18, 1], [22, 0], [25, 3], [26, 7], [1, 11], [0, 14], [1, 18], [2, 22]];
const TREE_KIND = { spring: ['spring1', 'blossom', 'spring2', 'bush'], beach: ['palm1', 'palm2', 'bush'], autumn: ['maple', 'autumn', 'bush'],
                    snow: ['pine1', 'pine2'], stars: ['star', 'bush'], candy: ['candy', 'bush'] };
const TREE_LOOK = { spring1: [150, 1.441, .931], spring2: [150, 1.456, .931], blossom: [150, 1.282, .922], bush: [125, 1.044, .904],
                    palm1: [150, 1.421, .93], palm2: [150, 1.335, .925], maple: [150, 1.24, .919], autumn: [150, 1.368, .927],
                    pine1: [135, 1.667, .94], pine2: [135, 1.663, .94], star: [150, 1.344, .926], candy: [150, 1.342, .925] };
export function trees(theme) {
  const kinds = TREE_KIND[theme] ?? TREE_KIND.spring;
  return TREE_SPOTS.map(([i, j], k) => {
    const id = kinds[k % kinds.length], [w, aspect, base] = TREE_LOOK[id];
    return { id, i, j, w, aspect, base, ...center(i, j) };
  });
}
const treeCells = new Set(TREE_SPOTS.map(([i, j]) => j * N + i));

// ---------- 擺設的種類 ----------
// kind：furn 傢俱（寵物會用、走得過去）、house 小屋（寵物進去睡、擋路）、bowl 盆子、tile 樹叢花圃（擋路）、
//       fence 圍籬（擋路，自動接起來）、gate 小門（圍籬中間讓寵物進出）、path 小路地磚（鋪在地上，上面還能擺東西）
// w＝圖在島上多寬（點），aspect＝圖的高／寬，base＝格子中心落在圖的哪個高度（0 上、1 下），foot＝佔幾格 [i, j]，max＝最多擺幾個
const F = (w, aspect, extra = {}) => ({ kind: 'furn', w, aspect, base: .88, foot: [1, 1], max: 1, ...extra });
export const CAT = {
  bed: F(70, .77), tent: F(70, .985), slide: F(75, .835), fountain: F(46, 1.136), pool: F(67, .68), swing: F(58, 1.081),
  bench: F(61, .705), tunnel: F(55, .815), toybox: F(36, .885), flowers: F(31, 1.081), lantern: F(26, 1.626),
  scratcher: F(34, 1.408), sandbox: F(65, .73), trampoline: F(63, .749), hammock: F(58, .966), 'rabbit-lamp': F(32, 1.176),
  'pumpkin-lamp': F(34, 1.081), 'ghost-house': F(58, 1.227), 'candy-bucket': F(37, 1.111), 'web-swing': F(58, 1.099),
  'house-basic': { kind: 'house', w: 185, aspect: .947, base: .736, foot: [2, 2], max: 3 },
  'house-mushroom': { kind: 'house', w: 185, aspect: .993, base: .748, foot: [2, 2], max: 1 },
  'house-tree': { kind: 'house', w: 185, aspect: 1.134, base: .78, foot: [2, 2], max: 1 },
  'house-igloo': { kind: 'house', w: 185, aspect: .833, base: .7, foot: [2, 2], max: 1 },
  'bowl-food': { kind: 'bowl', w: 46, aspect: .833, base: .76, foot: [1, 1], max: 1 },
  'bowl-water': { kind: 'bowl', w: 46, aspect: .833, base: .76, foot: [1, 1], max: 2 },
  's-fence-white': { kind: 'fence', tone: 'white' },
  's-fence-wood': { kind: 'fence', tone: 'wood' },
  's-gate': { kind: 'gate' },
  's-path-stone': { kind: 'path', tone: 'stone' },
  's-path-wood': { kind: 'path', tone: 'wood' },
  's-path-brick': { kind: 'path', tone: 'brick' },
  's-hedge': { kind: 'tile', w: 94, aspect: .962, base: .74 },
  's-flowerbed': { kind: 'tile', w: 92, aspect: .726, base: .656 },
  's-veg': { kind: 'tile', w: 92, aspect: .671, base: .627 },
};
export const isBuild = (id) => id.startsWith('s-');                    // 圍籬小路這類（另外算 150 格）
export const kindOf = (id) => CAT[id]?.kind;
const SOLID = new Set(['house', 'tile', 'fence']);
const footOf = (id, f) => { const [a, b] = CAT[id]?.foot ?? [1, 1]; return f ? [b, a] : [a, b]; };
export function cellsOf(id, i, j, f) {
  const [a, b] = footOf(id, f), out = [];
  for (let di = 0; di < a; di++) for (let dj = 0; dj < b; dj++) out.push([i + di, j + dj]);
  return out;
}
// 這件東西在島上的位置（佔地的正中間）
export function spot(id, i, j, f) {
  const [a, b] = footOf(id, f);
  return { x: cx(i + a / 2, j + b / 2), y: cy(i + a / 2, j + b / 2) };
}
const cx = (i, j) => (TX + (i - j) * CW / 2) / GW;
const cy = (i, j) => (TY + (i + j) * CH / 2) / GH;
export const center = (i, j) => ({ x: cx(i + .5, j + .5), y: cy(i + .5, j + .5) });
export function cellOf(x, y) {
  const a = (x * GW - TX) / (CW / 2), b = (y * GH - TY) / (CH / 2);
  return { i: Math.floor((a + b) / 2), j: Math.floor((b - a) / 2) };
}

// ---------- 佔地表：哪一格被誰佔了、寵物能不能走 ----------
// items：[{ id, i, j, f }]；回傳 { obj, floor, solid }（obj/floor 存 items 的索引 +1，0＝空）
export function occupancy(items) {
  const obj = new Int16Array(N * N), floor = new Int16Array(N * N), solid = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) if (MASK[Math.floor(c / N)][c % N] !== '1' || treeCells.has(c)) solid[c] = 1;
  items.forEach((o, k) => {
    const kind = kindOf(o.id);
    for (const [i, j] of cellsOf(o.id, o.i, o.j, o.f)) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const c = j * N + i;
      if (kind === 'path') floor[c] = k + 1; else obj[c] = k + 1;
      if (SOLID.has(kind)) solid[c] = 1;
    }
  });
  return { obj, floor, solid };
}
// 能不能擺在 (i, j)：每一格都要是草地沙灘、沒有樹、同一層沒被別的東西佔（self＝自己在 items 的索引，搬動時不算自己）
export function canPlace(occ, id, i, j, f, self = -1) {
  const layer = kindOf(id) === 'path' ? occ.floor : occ.obj;
  return cellsOf(id, i, j, f).every(([a, b]) => ground(a, b) === '1' && !treeCells.has(b * N + a)
    && (layer[b * N + a] === 0 || layer[b * N + a] === self + 1));
}
// 離 (i, j) 最近、擺得下的格子（螺旋往外找）
export function nearestFree(occ, id, i, j, f, self = -1) {
  for (let r = 0; r < N; r++) {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (canPlace(occ, id, i + di, j + dj, f, self)) return { i: i + di, j: j + dj };
    }
  }
  return null;
}

// ---------- 找路：寵物不穿過圍籬、樹叢、小屋、池塘 ----------
export const walkableIn = (solid, x, y) => { const { i, j } = cellOf(x, y); return i >= 0 && j >= 0 && i < N && j < N && !solid[j * N + i]; };
function lineFree(solid, a, b) {
  const n = Math.ceil(Math.hypot((b.x - a.x) * GW, (b.y - a.y) * GH) / 12);
  for (let k = 1; k < n; k++) if (!walkableIn(solid, a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n)) return false;
  return true;
}
export { lineFree };
// 從 from 走到 to 的路（中途點陣列，最後一點是 to）；走不到回傳 null
export function route(solid, from, to) {
  if (!walkableIn(solid, to.x, to.y)) return null;
  if (lineFree(solid, from, to)) return [to];
  const s = cellOf(from.x, from.y), t = cellOf(to.x, to.y);
  const si = Math.min(N - 1, Math.max(0, s.i)), sj = Math.min(N - 1, Math.max(0, s.j));
  const prev = new Int16Array(N * N).fill(-1), start = sj * N + si, goal = t.j * N + t.i;
  prev[start] = start;
  const q = [start];
  for (let h = 0; h < q.length && prev[goal] < 0; h++) {
    const c = q[h], i = c % N, j = Math.floor(c / N);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const n = b * N + a;
      if (prev[n] >= 0 || solid[n]) continue;
      if (di && dj && (solid[j * N + a] || solid[b * N + i])) continue;    // 斜走不切角
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[goal] < 0) return null;
  const cells = [];
  for (let c = goal; c !== start; c = prev[c]) cells.unshift(c);
  const pts = cells.map((c) => center(c % N, Math.floor(c / N)));
  pts[pts.length - 1] = to;
  // 拉直：看得到就直接走過去
  const out = [];
  let cur = from;
  for (let k = 0; k < pts.length;) {
    let far = k;
    while (far + 1 < pts.length && lineFree(solid, cur, pts[far + 1])) far++;
    out.push(pts[far]);
    cur = pts[far];
    k = far + 1;
  }
  return out;
}
// 從 from 走得到的格子（給隨便逛逛挑地方）
export function reachable(solid, from) {
  const s = cellOf(from.x, from.y);
  const seen = new Uint8Array(N * N), out = [];
  if (s.i < 0 || s.j < 0 || s.i >= N || s.j >= N || solid[s.j * N + s.i]) return out;
  const q = [s.j * N + s.i];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], i = c % N, j = Math.floor(c / N);
    out.push(c);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * N + a;
      if (a < 0 || b < 0 || a >= N || b >= N || seen[n] || solid[n]) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return out;
}

// ---------- 畫：圍籬（每格一張小 SVG，跟寵物一起排前後）、小路（一張鋪在地上的 SVG）、裝扮時的格子 ----------
const FENCE_TONE = { white: ['#fffdf6', '#b8ab95', '#e9e1d2'], wood: ['#d39a5c', '#7a4a22', '#b77c40'] };
// nb：四個方向有沒有接著圍籬或小門 { pi, ni, pj, nj }；回傳 { html, left, top, z }（left/top 是島上的點）
export function fenceEl(id, i, j, nb) {
  const c = center(i, j), X = c.x * GW, Y = c.y * GH;
  const W = 100, H = 90, ox = 50, oy = 66;            // SVG 裡格子中心的位置
  const E = { pi: [22.5, 11.25], ni: [-22.5, -11.25], pj: [-22.5, 11.25], nj: [22.5, -11.25] };
  let svg = '';
  if (kindOf(id) === 'gate') {
    const along = (nb.pj || nb.nj) && !(nb.pi || nb.ni) ? ['pj', 'nj'] : ['pi', 'ni'];
    const [p1, p2] = along.map((k) => [ox + E[k][0] * .92, oy + E[k][1] * .92]).sort((a, b) => a[1] - b[1]);
    const post = ([x, y]) => `<rect x="${x - 5}" y="${y - 44}" width="10" height="44" rx="3" fill="#c98a4b" stroke="#6b3f1f" stroke-width="1.6"/>
      <circle cx="${x}" cy="${y - 46}" r="5.5" fill="#ffd36b" stroke="#6b3f1f" stroke-width="1.4"/>`;
    svg = `<path d="M${p1[0]} ${p1[1] - 38} Q${(p1[0] + p2[0]) / 2} ${Math.min(p1[1], p2[1]) - 62} ${p2[0]} ${p2[1] - 38}" fill="none" stroke="#6b3f1f" stroke-width="7" stroke-linecap="round"/>
      <path d="M${p1[0]} ${p1[1] - 38} Q${(p1[0] + p2[0]) / 2} ${Math.min(p1[1], p2[1]) - 62} ${p2[0]} ${p2[1] - 38}" fill="none" stroke="#c98a4b" stroke-width="4" stroke-linecap="round"/>
      ${post(p1)}${post(p2)}`;
  } else {
    const [fill, line, shade] = FENCE_TONE[CAT[id].tone];
    let dirs = Object.keys(E).filter((k) => nb[k]);
    if (!dirs.length) dirs = ['pi', 'ni'];
    const seg = (k) => {
      const [ex, ey] = E[k];
      let s = `<path d="M${ox} ${oy} L${ox + ex} ${oy + ey}" stroke="rgba(30,60,20,.18)" stroke-width="6" stroke-linecap="round"/>`;
      for (const h of [12, 25]) s += `<path d="M${ox} ${oy - h} L${ox + ex} ${oy + ey - h}" stroke="${line}" stroke-width="5" stroke-linecap="round"/><path d="M${ox} ${oy - h} L${ox + ex} ${oy + ey - h}" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>`;
      for (const t of [.42, .84]) {
        const x = ox + ex * t, y = oy + ey * t;
        s += `<path d="M${x - 3.5} ${y} L${x - 3.5} ${y - 27} L${x} ${y - 32} L${x + 3.5} ${y - 27} L${x + 3.5} ${y} Z" fill="${fill}" stroke="${line}" stroke-width="1.3" stroke-linejoin="round"/>
          <path d="M${x + 1.5} ${y - 2} L${x + 1.5} ${y - 26}" stroke="${shade}" stroke-width="1.6"/>`;
      }
      return s;
    };
    const back = dirs.filter((k) => E[k][1] < 0), front = dirs.filter((k) => E[k][1] > 0);
    svg = back.map(seg).join('') + `<rect x="${ox - 5}" y="${oy - 36}" width="10" height="36" rx="2.5" fill="${fill}" stroke="${line}" stroke-width="1.5"/>
      <path d="M${ox - 6} ${oy - 36} L${ox} ${oy - 42} L${ox + 6} ${oy - 36} Z" fill="${fill}" stroke="${line}" stroke-width="1.4" stroke-linejoin="round"/>` + front.map(seg).join('');
  }
  return { html: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${svg}</svg>`, left: X - ox, top: Y - oy, z: Math.round(c.y * 1000) };
}
// 四個方向的鄰居有沒有圍籬／小門
export function fenceNb(items, occ, i, j) {
  const at = (a, b) => { if (a < 0 || b < 0 || a >= N || b >= N) return false; const k = occ.obj[b * N + a]; return k > 0 && ['fence', 'gate'].includes(kindOf(items[k - 1].id)); };
  return { pi: at(i + 1, j), ni: at(i - 1, j), pj: at(i, j + 1), nj: at(i, j - 1) };
}
const PATH_TONE = { stone: ['#b9af9f', '#e4ddcf', '#cfc6b6'], wood: ['#8a5a30', '#c99560', '#b07a45'], brick: ['#9a4a35', '#d9775a', '#c2603f'] };
const diamond = (i, j, k = 1) => {
  const c = center(i, j), X = c.x * GW, Y = c.y * GH, w = CW / 2 * k, h = CH / 2 * k;
  return `${X},${Y - h} ${X + w},${Y} ${X},${Y + h} ${X - w},${Y}`;
};
// 鋪在地上的那一層：小路地磚＋裝扮時的格子
export function floorSvg(items, { grid = false } = {}) {
  let under = '', tiles = '';
  for (const o of items) {
    const tone = PATH_TONE[CAT[o.id]?.kind === 'path' && CAT[o.id].tone];
    if (!tone) continue;
    under += `<polygon points="${diamond(o.i, o.j, 1.06)}" fill="${tone[0]}" stroke="${tone[0]}" stroke-width="5" stroke-linejoin="round"/>`;
    if (CAT[o.id].tone === 'stone') tiles += `<polygon points="${diamond(o.i, o.j, .78)}" fill="${tone[1]}" stroke="${tone[2]}" stroke-width="3" stroke-linejoin="round"/>`;
    else {
      const c = center(o.i, o.j), X = c.x * GW, Y = c.y * GH;
      tiles += `<polygon points="${diamond(o.i, o.j, .94)}" fill="${tone[1]}" stroke="${tone[2]}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M${X - 11} ${Y - 16} L${X + 22} ${Y + .5} M${X - 22} ${Y - .5} L${X + 11} ${Y + 16}" stroke="${tone[2]}" stroke-width="2.4"/>`;
    }
  }
  let lines = '';
  if (grid) {
    let d = '';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (ground(i, j) === '1') d += `M${diamond(i, j).split(' ').join(' L')}Z`;
    lines = `<path d="${d}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/>`;
  }
  return `${under}${tiles}${lines}`;
}
// 裝扮時佔地的框（綠＝擺得下、紅＝擺不下）
export function footSvg(id, i, j, f, ok) {
  return cellsOf(id, i, j, f).map(([a, b]) => `<polygon points="${diamond(a, b, .96)}" fill="${ok ? 'rgba(120,230,120,.35)' : 'rgba(240,80,60,.4)'}" stroke="${ok ? '#4fbf4f' : '#e2553f'}" stroke-width="3"/>`).join('');
}

// ---------- 舊的擺法（第 1 期：{ id: { x, y, f } }，島是 1120×842 的圓島）搬到新的大島 ----------
// old：舊 layout；ids：要擺出來的傢俱（沒有舊位置的照預設位置）；dflt：{ id: { x, y } } 舊島上的預設位置
export function migrate(old, ids, dflt) {
  const items = [];
  let occ = occupancy(items);
  const put = (id, at, f = 0) => {
    // 舊島的可走範圍大約 x .18～.93、y .29～.84，縮到新島中間偏前
    const x = .5 + (at.x - .55) * .5, y = .62 + (at.y - .56) * .5;
    const c = cellOf(x, y), p = nearestFree(occ, id, c.i, c.j, f);
    if (!p) return;
    items.push({ id, i: p.i, j: p.j, f });
    occ = occupancy(items);
  };
  for (const id of ids) if (CAT[id]) put(id, old?.[id] ?? dflt[id] ?? { x: .6, y: .65 }, old?.[id]?.f ? 1 : 0);
  return items;
}
// 新的島（還沒有小屋、盆子）：小屋、飼料盆、水盆擺在中間
export function starter(items) {
  const out = [...items];
  for (const [id, i, j] of [['house-basic', 14, 12], ['bowl-food', 13, 15], ['bowl-water', 15, 15]]) {
    if (out.some((o) => o.id === id)) continue;
    const occ = occupancy(out), p = nearestFree(occ, id, i, j, 0);
    if (p) out.push({ id, i: p.i, j: p.j, f: 0 });
  }
  return out;
}
export const pack = (items) => ({ v: 2, items: items.map((o) => [o.id, o.i, o.j, o.f ? 1 : 0]) });
export const unpack = (layout) => (layout?.v === 2 && Array.isArray(layout.items)
  ? layout.items.filter((x) => Array.isArray(x) && CAT[x[0]]).map(([id, i, j, f]) => ({ id, i, j, f: f ? 1 : 0 }))
  : null);
// 島上比例 → 格子（小數，拖曳時算佔地正中間用）
export function cellF(x, y) {
  const a = (x * GW - TX) / (CW / 2), b = (y * GH - TY) / (CH / 2);
  return { i: (a + b) / 2, j: (b - a) / 2 };
}
