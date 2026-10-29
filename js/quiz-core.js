// 時光試煉島的規則（純函式，後台用；測試在 tools/test/quiz-core.test.mjs）：
//   1. 每個知識點的狀態：學會／待加強／玩過還沒學會／沒玩過
//   2. 自動挑題：5 成待加強、3 成玩過還沒學會、2 成沒玩過，30 天前學會的抽查一點
//   3. 報告：遊戲對錯 × 卷上對錯的判讀
//
// 「學會」＝同一個知識點，在不同的兩天、用不同的題目（遊戲裡第一次就答對算一題）答對，而且最近一次是對的。
// 家長按「改回要加強」之後，之前答對的都不算。
export const DAY = 864e5;
const dayOf = (t) => new Date(new Date(t).getTime() + 8 * 3600e3).toISOString().slice(0, 10);   // 臺灣的日期

export const PLACE_NAME = {
  pro: '序章 認識臺灣', ch1: '第一章 史前', ch2: '第二章 原住民族', ch3: '第三章 大航海時代', ch4: '第四章 鄭氏時期',
  ch5: '第五章 八堡圳', ch6: '第六章 開港與鐵路', ch7: '第七章 日治時期', end: '終章 今天的島嶼',
  town: '現在篇・規則小鎮', isles: '現在篇・離島巡航', sky: '現在篇・天空港', post: '現在篇・景點明信片',
  'a-forest': '祕境島・森林', 'a-nest': '祕境島・螞蟻地下城', 'a-harbor': '祕境島・海港工坊', 'a-town': '祕境島・劇場小鎮', 'a-sky': '祕境島・山頂天文台',
};
export const placeZone = (place) => (String(place).startsWith('a-') ? 'science' : 'taiwan');
export const placeGame = (place) => (String(place).startsWith('a-') ? '時光祕境島' : '島嶼開拓者');

export const STATE_NAME = { learned: '學會了', weak: '待加強', seen: '玩過還沒學會', new: '還沒玩過' };

// kid＝park_quiz_class 的一個孩子：{ played:[place], game:[[kp, ok, at]], ans:[[kp, item, got, at, ms]], marks:{kp: at} }
export function kidStates(kid, kps, now = Date.now()) {
  const played = new Set(kid.played ?? []);
  const out = {};
  for (const k of kps) out[k.id] = { kp: k.id, place: k.place, events: [], game: null, rightItems: new Set() };
  for (const [kp, ok, at] of kid.game ?? []) {
    const s = out[kp]; if (!s) continue;
    s.game = { ok: !!ok, at };
    s.events.push({ ok: !!ok, at: new Date(at).getTime(), src: 'game:' + kp });
  }
  for (const [kp, item, got, at] of kid.ans ?? []) {
    const s = out[kp]; if (!s) continue;
    const ok = Number(got) >= 1;
    if (ok) s.rightItems.add(item);
    s.events.push({ ok, at: new Date(at).getTime(), src: item, quiz: true });
  }
  for (const s of Object.values(out)) {
    const mark = kid.marks?.[s.kp] ? new Date(kid.marks[s.kp]).getTime() : 0;
    const ev = s.events.filter((e) => e.at > mark).sort((a, b) => a.at - b.at);
    const right = ev.filter((e) => e.ok);
    const days = new Set(right.map((e) => dayOf(e.at))), srcs = new Set(right.map((e) => e.src));
    const last = ev[ev.length - 1];
    s.tries = ev.length;
    s.quizTries = ev.filter((e) => e.quiz).length;
    s.lastRight = right.length ? right[right.length - 1].at : null;
    s.marked = !!mark;
    if (last && last.ok && days.size >= 2 && srcs.size >= 2) s.state = 'learned';
    else if ((last && !last.ok) || mark) s.state = 'weak';
    else if (played.has(s.place) || ev.length) s.state = 'seen';
    else s.state = 'new';
    s.due = s.state === 'learned' && s.lastRight < now - 30 * DAY;   // 學會超過 30 天，可以抽查
    delete s.events;
  }
  return out;
}

// 一張卷的題型比例（照市售評量的配置）
export const KIND_MIX = { tf: 0.2, mc: 0.3, who: 0.1, multi: 0.1, order: 0.1, cat: 0.1, cloze: 0.1 };
const SHARE = { weak: 0.5, seen: 0.3, new: 0.2 };

// 自動挑題。bank＝park_quiz_bank；states＝kidStates；opt：{ n, subjects:Set, places:Set|null, rand }
// 回傳 [{ item, bucket }]，照知識點的課本順序排
export function pickPaper(bank, states, { n = 20, subjects = new Set(['soc', 'sci']), places = null, rand = Math.random, avoid = new Set() } = {}) {
  const kpById = new Map(bank.kps.map((k) => [k.id, k]));
  const itemsByKp = new Map();
  for (const it of bank.items) {
    const k = kpById.get(it.kp);
    if (!k || !subjects.has(k.subject) || (places && !places.has(k.place))) continue;
    if (states[it.kp]?.rightItems?.has(it.id)) continue;    // 答對過的原題不再出
    if (avoid.has(it.id)) continue;
    (itemsByKp.get(it.kp) ?? itemsByKp.set(it.kp, []).get(it.kp)).push(it);
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pool = { weak: [], seen: [], new: [], review: [] };
  for (const [kp, list] of itemsByKp) {
    if (!list.length) continue;
    const s = states[kp];
    const b = !s ? 'new' : s.state === 'learned' ? (s.due ? 'review' : null) : s.state;
    if (b) pool[b].push(kp);
  }
  for (const b of Object.keys(pool)) shuffle(pool[b]);
  // 先照比例分，不夠的用其他籃補（順序：待加強→玩過→沒玩過→抽查）
  const want = { weak: Math.round(n * SHARE.weak), seen: Math.round(n * SHARE.seen) };
  want.new = n - want.weak - want.seen;
  const chosen = [];   // [kp, bucket]
  for (const b of ['weak', 'seen', 'new']) while (chosen.length < n && want[b] > 0 && pool[b].length) { chosen.push([pool[b].shift(), b]); want[b]--; }
  for (const b of ['weak', 'seen', 'new', 'review']) while (chosen.length < n && pool[b].length) chosen.push([pool[b].shift(), b]);
  // 知識點不夠時，同一個知識點出第二題（待加強的優先）
  const used = new Set();
  const second = chosen.filter(([kp]) => (itemsByKp.get(kp)?.length ?? 0) > 1).sort((a, b) => (a[1] === 'weak' ? -1 : 0) - (b[1] === 'weak' ? -1 : 0));
  for (const c of second) { if (chosen.length >= n) break; chosen.push([c[0], c[1]]); }
  // 每個知識點挑一題：挑題型最缺的那一種、和上次不同的題目
  const have = Object.fromEntries(Object.keys(KIND_MIX).map((k) => [k, 0]));
  const out = [];
  for (const [kp, bucket] of chosen) {
    const list = shuffle(itemsByKp.get(kp).filter((it) => !used.has(it.id)));
    if (!list.length) continue;
    const total = out.length + 1;
    list.sort((a, b) => (have[a.kind] - KIND_MIX[a.kind] * total) - (have[b.kind] - KIND_MIX[b.kind] * total));
    const it = list[0];
    used.add(it.id); have[it.kind]++;
    out.push({ item: it.id, bucket, kp, sort: kpById.get(kp).sort });
  }
  return out.sort((a, b) => a.sort - b.sort).map(({ item, bucket }) => ({ item, bucket }));
}

// 報告：一題的判讀。gameOk＝遊戲裡第一次對不對（null＝遊戲裡沒有這題）；played＝那一關玩過沒
export function readSlot({ got, ms, kind }, gameOk, played) {
  const ok = Number(got) >= 1;
  const fast = !ok && ms != null && ms > 0 && ms < (kind === 'tf' ? 2000 : 3000);
  let code, text;
  if (gameOk === true && ok) { code = 'solid'; text = '遊戲和卷上都對，很穩。'; }
  else if (gameOk === true && !ok) { code = 'ask'; text = '遊戲裡對、卷上錯：可能當時是猜對的，或是忘了。問問孩子「你怎麼想的？」'; }
  else if (gameOk === false && ok) { code = 'grew'; text = '遊戲裡錯過、現在答對：後來學會了。'; }
  else if (gameOk === false && !ok) { code = 'stuck'; text = '遊戲和卷上都錯：還沒弄懂。陪孩子看課本這一段，再回遊戲玩一次。'; }
  else if (ok) { code = played ? 'ok' : 'ahead'; text = played ? '答對了。' : '還沒玩到這裡就答對了，可能課本學過。'; }
  else { code = played ? 'miss' : 'notyet'; text = played ? '玩過這一關，卷上答錯：可以回去再玩一次，搭配課本複習。' : '還沒玩到這一關。可以推薦孩子去玩，也搭配課本複習。'; }
  return { code, text, fast };
}
