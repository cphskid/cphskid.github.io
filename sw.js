// 樂園的 Service Worker：把圖和聲音存進裝置，之後進來直接從裝置拿，不用等網路。
// 每次打開網頁時順便抓一次 data/sw-manifest.json（node tools/warm-list.mjs 產生；推到 dev 時 GitHub 會自動重產）：
// 裡面是 img/、audio/ 每個檔案的指紋（md5 前 12 碼）。圖換了指紋就變，這次進來就重新下載；沒換的從裝置拿。
// 清單裡沒有的圖（例如 img/ts/ 小兵）：先給存的，背景再問網路有沒有新的，下次進來就是新的。
// 網頁、js、css、資料照舊問網路（跟沒有 Service Worker 時一樣），斷線才用存的。
const CACHE = 'park-v1';
const BASE = new URL('./', self.location).pathname;
const MANIFEST_URL = `${BASE}data/sw-manifest.json`;

const rel = (url) => decodeURIComponent(new URL(url).pathname.slice(BASE.length));
const keyOf = (m, r) => (m.files[r] ? `${BASE}${r}?h=${m.files[r]}` : null);

let manifest = null;
function fetchManifest() {
  manifest = (async () => {
    const c = await caches.open(CACHE);
    const old = await c.match(MANIFEST_URL).then((r) => r?.json()).catch(() => null);
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const m = await res.clone().json();
      if (!old || old.v !== m.v) { await c.put(MANIFEST_URL, res); void prune(c, m); }
      return m;
    } catch {
      return old ?? { v: '', files: {} };
    }
  })();
  return manifest;
}
// 換版：舊指紋的圖清掉
async function prune(c, m) {
  for (const req of await c.keys()) {
    const u = new URL(req.url);
    if (u.search && keyOf(m, rel(req.url)) !== u.pathname + u.search) await c.delete(req);
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('park-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const ok = (res) => res.ok && res.status === 200;

async function media(e, req) {
  const m = await (manifest ?? fetchManifest());
  const c = await caches.open(CACHE);
  const r = rel(req.url);
  const key = keyOf(m, r);
  if (key) {
    const hit = await c.match(key);
    if (hit) return hit;
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (ok(res)) c.put(key, res.clone()).catch(() => {});
    return res;
  }
  // 清單裡沒有：有存的先給，背景更新
  const plain = BASE + r;
  const hit = await c.match(plain);
  const fresh = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (ok(res)) c.put(plain, res.clone()).catch(() => {});
    return res;
  });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

// 網頁、程式、資料：每次都跟網路確認是不是最新（no-cache：沒換只回 304，很快），順便存一份給斷線用。
// 不用瀏覽器暫存規則：那樣最多會拿到 10 分鐘前的檔，剛推新版時新舊 js 混在一起會開不起來。
// 網路一時失敗（換 Wi-Fi、Safari 偶發的 Load failed）先再試一次，再不行用存的；
// 都沒有就再交給網路一次，不讓 Service Worker 變成「無法打開網頁」的原因。
async function code(req, nav) {
  if (nav) void fetchManifest();
  const c = await caches.open(CACHE);
  const key = new URL(req.url).pathname;
  const get = () => fetch(req, { cache: 'no-cache' });
  try {
    const res = await get().catch(() => new Promise((r) => setTimeout(r, 300)).then(get));
    if (ok(res)) c.put(key, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await c.match(key)) ?? (nav ? await c.match(BASE) : undefined) ?? fetch(req);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(BASE)) return;
  const r = rel(req.url);
  if (/^(img|audio)\//.test(r)) return e.respondWith(media(e, req));
  // 只管樂園自己的網頁和程式；底下別的資料夾（例如各遊戲、/dev/ 測試站）不管
  if (req.mode === 'navigate' ? /^[^/]*$/.test(r) : /^(js|css|data)\//.test(r)) e.respondWith(code(req, req.mode === 'navigate'));
});

// 網頁交來的清單：Service Worker 裝好之前已經抓過的圖，補存進來（多半從瀏覽器暫存拿）
self.addEventListener('message', (e) => {
  const urls = e.data?.keep;
  if (!Array.isArray(urls)) return;
  e.waitUntil((async () => {
    const m = await (manifest ?? fetchManifest());
    const c = await caches.open(CACHE);
    for (const url of urls) {
      const r = rel(url);
      if (!/^(img|audio)\//.test(r)) continue;
      const key = keyOf(m, r) ?? BASE + r;
      if (await c.match(key)) continue;
      try {
        const res = await fetch(new URL(url).pathname);
        if (ok(res)) await c.put(key, res);
      } catch { /* 下次再存 */ }
    }
  })());
});
