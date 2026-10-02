// 樂園的音效與音樂。檔名就是全站統一編號（樂園音效提示詞那份），放在 audio/，例如 audio/SE-01.mp3。
//
// 規則（照守護異世界的經驗）：音效小聲、自己可以關；音樂只放開場與樂園地圖，底下墊著海浪；
// 老師後台完全不放聲音（teacher.html 不載這支）。
// 瀏覽器要等使用者點過一次才肯出聲，第一次點畫面時才解鎖。

const url = (code) => `audio/${code}.mp3`;
const VOL = { se: 0.5, music: 0.3, amb: 0.25 };

// ---------- 開關（存在這台平板） ----------
// all 全開／sfx 只有音效／off 全關
const FLAG = 'park.audio.mode';
function readMode() {
  try { const v = localStorage.getItem(FLAG); return v === 'sfx' || v === 'off' ? v : 'all'; } catch { return 'all'; }
}
let mode = readMode();
export const getMode = () => mode;
export function setMode(m) {
  mode = m;
  try { localStorage.setItem(FLAG, m); } catch { /* 存不了就只管這次 */ }
  if (m !== 'all') stopLoop('music');
  if (m === 'off') stopLoop('amb');
  else resumeWanted();
}

// ---------- WebAudio ----------
let ctx = null;
const buffers = new Map(); // code → AudioBuffer | null（沒有這個檔）| Promise
function audio() {
  if (ctx) return ctx;
  const C = window.AudioContext ?? window.webkitAudioContext;
  if (!C) return null;
  try { ctx = new C(); } catch { return null; }
  return ctx;
}
function unlock() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().then(resumeWanted);
  else resumeWanted();
}
const once = () => { unlock(); removeEventListener('pointerdown', once, true); removeEventListener('keydown', once, true); };
addEventListener('pointerdown', once, true);
addEventListener('keydown', once, true);

function load(code) {
  const have = buffers.get(code);
  if (have !== undefined) return Promise.resolve(have);
  const a = audio();
  if (!a) return Promise.resolve(null);
  const p = fetch(url(code))
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((b) => (b ? a.decodeAudioData(b) : null))
    .catch(() => null)
    .then((buf) => { buffers.set(code, buf); return buf; });
  buffers.set(code, p);
  return p;
}
export function preload(codes) { codes.forEach((c) => load(c)); }

function out(gain) {
  const a = audio();
  if (!a) return null;
  const g = a.createGain();
  g.gain.value = gain;
  g.connect(a.destination);
  return g;
}

// ---------- 音效 ----------
export function sfx(code) {
  if (mode === 'off') return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  load(code).then((buf) => {
    if (!buf || mode === 'off') return;
    const g = out(VOL.se);
    if (!g) return;
    const s = a.createBufferSource();
    s.buffer = buf;
    s.connect(g);
    s.start();
  });
}

// ---------- 循環：音樂與環境音，換畫面時呼叫一次就好，同一首不會重來 ----------
const wanted = { music: null, amb: null };
const playing = { music: null, amb: null };
const allowed = (lane) => (lane === 'music' ? mode === 'all' : mode !== 'off');
function want(lane, code) {
  wanted[lane] = code;
  if (playing[lane]?.code === code) return;
  stopLoop(lane);
  if (code) startLoop(lane, code);
}
export const music = (code) => want('music', code);
export const ambience = (code) => want('amb', code);

async function startLoop(lane, code) {
  const a = audio();
  if (!a || a.state !== 'running' || !allowed(lane)) return;
  const buf = await load(code);
  if (!buf || wanted[lane] !== code || playing[lane] || !allowed(lane)) return;
  const g = out(0);
  if (!g) return;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(g);
  src.start();
  g.gain.linearRampToValueAtTime(lane === 'music' ? VOL.music : VOL.amb, a.currentTime + 1.2);
  playing[lane] = { code, src, gain: g };
}
function stopLoop(lane) {
  const p = playing[lane];
  if (!p) return;
  playing[lane] = null;
  const a = audio();
  const t = a.currentTime;
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + 0.6);
  p.src.stop(t + 0.7);
}
function resumeWanted() {
  for (const lane of ['music', 'amb']) if (wanted[lane] && !playing[lane]) startLoop(lane, wanted[lane]);
}
// 切到別的分頁就停，回來再接著放
document.addEventListener('visibilitychange', () => {
  const a = ctx;
  if (!a) return;
  if (document.hidden) a.suspend();
  else a.resume().then(resumeWanted);
});
