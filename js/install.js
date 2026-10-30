// 把樂園加到桌面（桌面捷徑）。
//
// Android／電腦的 Chrome、Edge：接住 beforeinstallprompt，按鈕一按就跳安裝視窗。
// iPhone／iPad：沒有安裝視窗，只能教「分享 → 加入主畫面」，手指指著分享鍵在哪裡。
// LINE、FB、IG、Threads 裡面開的：那裡不能加到桌面，先請他用瀏覽器打開（LINE 可以直接跳出去）。
// 齒輪選單一直有「加到桌面」；第二天以後來玩，在地圖上會自己跳一次提醒（一天最多一次，按三次「下次再說」就不再跳）。
// 第一次從桌面圖示打開，送 50 時光幣（park_coins.sql 的 park_app_home）。
import * as auth from './auth.js';

const $ = (s, root = document) => root.querySelector(s);
const ua = navigator.userAgent;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ipad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = /Android/.test(ua);
const inapp = /Line\//.test(ua) ? 'LINE' : /FBAN|FBAV|FB_IAB|FBIOS/.test(ua) ? 'Facebook' : /Instagram/.test(ua) ? 'Instagram' : /Barcelona|Threads/.test(ua) ? 'Threads' : null;
const iosSafari = ios && !inapp && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
const safariVer = +(ua.match(/Version\/(\d+)/)?.[1] ?? 0);

const KEY = 'park-a2hs';            // { days: [...最近來玩的日子], shown: 'YYYY-MM-DD', no: 按「下次再說」幾次 }
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 無痕模式 */ } };
const today = () => new Date().toLocaleDateString('sv');

let hooks = { me: () => ({ kind: 'guest' }), toast: () => {}, coins: () => {}, free: () => true };
let ask = null;                     // beforeinstallprompt 事件
let timer = 0;

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ask = e; });
addEventListener('appinstalled', () => { ask = null; close(); hooks.toast('加好了！之後點桌面上的「時空樂園」就能直接進來'); });

const SHARE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5v10h14V11h-1"/></svg>';
const PLUS = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

export function init(h) {
  hooks = { ...hooks, ...h };
  const btn = $('#a2hs-btn');
  if (btn) {
    btn.hidden = standalone();
    btn.addEventListener('click', () => { $('#gear-menu').hidden = true; open(false); });
  }
}

// 每次換人／載入完叫一次
export function load(w = hooks.me()) {
  clearTimeout(timer);
  if (w.kind === 'guest') return;
  if (standalone()) { paid(w); return; }
  const s = read();
  const d = today();
  s.days = [...new Set([...(s.days ?? []), d])].slice(-5);
  write(s);
  if (s.days.length < 2 || s.shown === d || (s.no ?? 0) >= 3) return;
  // 等他在地圖上站穩、沒有別的視窗開著才跳
  let tries = 0;
  const later = () => {
    timer = setTimeout(() => {
      if (hooks.free()) { write({ ...read(), shown: today() }); open(true); }
      else if (++tries < 6) later();
    }, tries ? 20000 : 8000);
  };
  later();
}

async function paid(w) {
  if (w.kind !== 'student') return;
  try {
    const n = await auth.coins.home();
    if (n > 0) { hooks.toast(`從桌面打開樂園，送你 ${n} 時光幣！`); hooks.coins(); }
  } catch { /* 資料庫還沒裝好就算了 */ }
}

function how() {
  if (inapp) {
    const out = inapp === 'LINE'
      ? `${location.origin}${location.pathname}${location.search ? `${location.search}&` : '?'}openExternalBrowser=1`
      : android ? `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end` : null;
    return {
      steps: [`你現在是在 ${inapp} 裡面打開的，這裡沒辦法加到桌面。`,
        out ? '先按下面的按鈕，用瀏覽器打開樂園，再按 ⚙ →「加到桌面」。' : `點右上角的 ⋯（或 ↗），選「用瀏覽器開啟」或「在 Safari 開啟」，再按 ⚙ →「加到桌面」。`],
      go: out ? `<a class="btn small" href="${out}">用瀏覽器打開</a>` : '',
      point: out ? null : 'tr',
    };
  }
  if (ask) return { steps: ['按下面的按鈕，再按「安裝」就好。'], go: '<button type="button" class="btn small" data-ask>📲 加到桌面</button>' };
  if (iosSafari) {
    const menu = safariVer >= 26 && !ipad;
    return {
      steps: [menu ? `點右下角的 ⋯，再點分享 ${SHARE}` : `點${ipad ? '右上角' : '下面'}的分享鍵 ${SHARE}`,
        `往下滑，點「加入主畫面」${PLUS}`, '右上角點「新增」，桌面就會出現樂園的圖示'],
      point: ipad ? 'tr' : menu ? 'br' : 'bc',
    };
  }
  if (ios) return { steps: [`點網址列旁邊的分享鍵 ${SHARE}`, `往下滑，點「加入主畫面」${PLUS}`, '點「新增」'], point: 'tr' };
  if (android) return { steps: ['點右上角的 ⋮', '選「加到主畫面」或「安裝應用程式」', '再按「新增」或「安裝」'], point: 'tr' };
  return { steps: ['Chrome／Edge：網址列右邊有個安裝圖示 ⊕，點它再按「安裝」', 'Safari（Mac）：上面選單「檔案」→「加入 Dock」'] };
}

function open(auto) {
  close();
  const h = how();
  const box = document.createElement('div');
  box.id = 'a2hs';
  box.innerHTML = `<div class="a2-card" role="dialog" aria-label="把樂園加到桌面">
    <img class="a2-icon" src="img/app/icon-192.png" alt="">
    <h3>把樂園放到桌面</h3>
    <p class="a2-why">下次點一下桌面的圖示就能直接進來，不用再找網址。<b>第一次從桌面打開，送你 50 時光幣！</b></p>
    <ol>${h.steps.map((t) => `<li>${t}</li>`).join('')}</ol>
    ${h.go ? `<div class="a2-go">${h.go}</div>` : ''}
    <div class="a2-foot"><button type="button" class="ghost" data-later>${auto ? '下次再說' : '關掉'}</button></div>
  </div>${h.point ? `<div class="a2-hand ${h.point}" aria-hidden="true">👇</div>` : ''}`;
  document.body.append(box);
  $('[data-later]', box).onclick = () => { if (auto) { const s = read(); write({ ...s, no: (s.no ?? 0) + 1 }); } close(); };
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  const a = $('[data-ask]', box);
  if (a) a.onclick = async () => { const e = ask; ask = null; e.prompt(); const r = await e.userChoice.catch(() => null); if (r?.outcome !== 'accepted') ask = e; close(); };
}
function close() { $('#a2hs')?.remove(); }
