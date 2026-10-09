// 把圖、聲音存進裝置（Service Worker，程式在 sw.js）。網址加 ?nosw=1 會把它拆掉（萬一出問題可以用）。
// 只在 https（或本機）開；正式站和測試站各自一份，範圍是 sw.js 所在的資料夾。
const base = new URL('./', document.baseURI).pathname.replace(/[^/]*$/, '');
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  if (new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => { if (new URL(r.scope).pathname === base) r.unregister(); }));
    caches.keys().then((ks) => ks.filter((k) => k.startsWith('park-')).forEach((k) => caches.delete(k)));
  } else {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then(() => navigator.serviceWorker.ready).then((reg) => {
      // 第一次來：Service Worker 裝好之前已經抓過的圖，交給它補存（從瀏覽器暫存拿，不會再下載一次）
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin + base));
      reg.active?.postMessage({ keep: urls });
    }).catch(() => {});
  }
}
