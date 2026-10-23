// 遊玩紀錄：學生在樂園大廳（島嶼地圖）、寵物島待了多久（supabase/park_playlog.sql）。
// 進到一個地方寫一筆，每 30 秒送一次心跳，切到別的 App、進遊戲、回開場、登出就收尾。
// 老師後台的學生時間軸、管理員的全站動態都靠它。沒裝 SQL、網路斷了就只是不記。
import { db } from './auth.js';

const BEAT_MS = 30000;
let on = false;          // 學生在大廳裡
let off = false;         // 資料庫還沒裝：之後都不送
let id = null;
let cur = { place: 'gate', label: '樂園大廳' };
let timer = 0;

async function call(fn, args) {
  if (!db || off) return null;
  try {
    const { data, error } = await db.rpc(fn, args);
    if (error?.code === 'PGRST202') off = true;
    return error ? null : data;
  } catch { return null; }
}
async function start() {
  clearInterval(timer);
  if (!on || document.hidden) return;
  const want = cur;
  id = await call('park_play_start', { p_facility: 'park', p_place: want.place, p_label: want.label });
  if (!on || cur !== want || id == null) return;
  timer = setInterval(() => { if (id != null) call('park_play_beat', { p_id: id }); }, BEAT_MS);
}
function stop() {
  clearInterval(timer);
  if (id != null) call('park_play_beat', { p_id: id, p_end: true });
  id = null;
}
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
addEventListener('pagehide', stop);

// 學生進到地圖（true）／回到開場、登出（false）
export function active(yes) {
  if (yes === on) return;
  on = yes;
  if (yes) start(); else stop();
}
// 在大廳裡換地方：寵物島、回到地圖
export function at(place, label) {
  if (cur.place === place) return;
  stop();
  cur = { place, label };
  start();
}
