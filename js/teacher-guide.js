// 老師後台的新手引導：第一次進來跑一次導覽（聚光＋說明，可跳過），之後「使用指南」頁籤和右上「？」隨時重看。
// 不是解鎖任務，只是告訴開班的人每個地方是做什麼的、該看哪裡。
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEEN = 'park.teacher.tour.v1';

export function tourSeen() {
  try { return localStorage.getItem(SEEN) === '1'; } catch { return true; }  // 讀不到就當看過，別每次都跳
}
function markSeen() { try { localStorage.setItem(SEEN, '1'); } catch { /* 私密視窗：下次再跳也沒關係 */ } }

// 每一步：指著誰（第一個找得到的）、標題、說明。找不到的步驟跳過（例如還沒開班就沒有班級代碼）。
const STEPS = [
  { at: ['#tabs [data-view=classes]'], title: '我的班級', text: '開班、拿班級代碼、決定開放哪些島，都在這裡。一個孩子可以同時加入好幾個班。' },
  { at: ['#p-info .codebox', '#new'], title: '把代碼給孩子', text: '孩子第一次來在樂園按「第一次來」填這組代碼；已經有帳號的，到「我的資料」輸入代碼加入。還沒開班的話，先按「開新班」。' },
  { at: ['#p-fac'], title: '開放哪些島', text: '勾選這個班可以玩的島。學生畫面不會出現科目和年級，只有玩法和星等。' },
  { at: ['#p-ov .ov', '#p-ov'], title: '全班總覽', text: '誰最近有來、在玩什麼、哪裡需要注意。欄位上的「細節頁」可以看每座島的進度、答對率和常錯的地方。' },
  { at: ['#tabs [data-view=play]'], title: '遊玩紀錄', text: '每個孩子每天玩了多久、去了哪裡。可以對照「一次 20–30 分、一週 3–5 天」的建議。' },
  { at: ['#tabs [data-view=quiz]'], title: '時光試煉島', text: '照孩子常錯的地方自動出一張試煉卷，你再調整。孩子在樂園外的試煉島作答，交卷後這裡看分析報告。' },
  { at: ['#tabs [data-view=news]', '#tabs [data-view=feedback]'], title: '公告和問題回報', text: '寄信鴿信給自己班的孩子；孩子在遊戲裡回報的問題也會出現在這裡。' },
  { at: ['#tabs [data-view=guide]'], title: '使用指南', text: '內容出處、帶孩子的重點、常見問題都在這裡。這段導覽也可以從這裡重看。' },
];

let box = null;
export function startTour(force = false) {
  if (!force && tourSeen()) return;
  const steps = STEPS.map((s) => ({ ...s, el: s.at.map((q) => $(q)).find((e) => e && e.offsetParent !== null) })).filter((s) => s.el);
  if (!steps.length) return;
  box?.remove();
  box = document.createElement('div');
  box.className = 'tour';
  box.innerHTML = '<div class="tour-hole"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.append(box);
  const hole = $('.tour-hole', box), tip = $('.tour-tip', box);
  let i = 0;
  const end = () => { markSeen(); box?.remove(); box = null; removeEventListener('resize', place); };
  function place() {
    const s = steps[i];
    const r = s.el.getBoundingClientRect();
    const pad = 8;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${Math.min(r.height, innerHeight * 0.6) + pad * 2}px` });
    const w = Math.min(360, innerWidth - 32);
    const below = r.top + Math.min(r.height, innerHeight * 0.6) + 20;
    const top = below + 200 < innerHeight ? below : Math.max(16, r.top - 220);
    Object.assign(tip.style, { width: `${w}px`, left: `${Math.max(16, Math.min(r.left, innerWidth - w - 16))}px`, top: `${top}px` });
  }
  function paint() {
    const s = steps[i];
    s.el.scrollIntoView({ block: 'center', behavior: 'instant' });
    tip.innerHTML = `<small>${i + 1} / ${steps.length}</small><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>
      <div class="row"><button class="ghost small" data-skip>${i + 1 < steps.length ? '跳過導覽' : ''}</button>
      ${i ? '<button class="ghost small" data-prev>上一步</button>' : ''}
      <button class="btn go small" data-next>${i + 1 < steps.length ? '下一步' : '開始使用'}</button></div>`;
    if (i + 1 >= steps.length) $('[data-skip]', tip).remove();
    $('[data-skip]', tip)?.addEventListener('click', end);
    $('[data-prev]', tip)?.addEventListener('click', () => { i--; paint(); });
    $('[data-next]', tip).onclick = () => { if (++i >= steps.length) end(); else paint(); };
    requestAnimationFrame(place);
    $('[data-next]', tip).focus();
  }
  addEventListener('resize', place);
  paint();
}

// ---------- 使用指南頁籤 ----------
export function renderGuide(view, { onTour }) {
  view.innerHTML = `
  <section class="panel guide">
    <div class="head"><h2><img class="hi" src="img/admin/help.webp" alt="">使用指南</h2>
      <button class="btn go small" data-tour>重看導覽</button></div>
    <p class="lead">開好班之後，平常大概只要做三件事：看<b>全班總覽</b>誰沒來、點<b>細節頁</b>看哪裡常錯、偶爾看一下<b>遊玩紀錄</b>有沒有玩太久。</p>
  </section>

  <section class="panel guide">
    <h2><img class="hi" src="img/admin/class.webp" alt="">每個頁籤是做什麼的</h2>
    <table class="gtab"><tbody>
      <tr><th>我的班級</th><td>開班、班級代碼、開放哪些島、全班總覽（最後活動、在玩什麼、需要注意）、重設學生密碼。總覽上每座島的「細節頁」看進度、答對率、常錯的地方，也能列印給孩子看。</td></tr>
      <tr><th>遊玩紀錄</th><td>全班每個人每天玩了幾分鐘；點孩子的名字看他每天去了哪些島、從幾點玩到幾點。</td></tr>
      <tr><th>時光試煉島</th><td>出試煉卷：照孩子在遊戲和之前的卷上錯的地方自動挑題，你再調整，可以出 10、20、30 題。交卷後看分析報告（哪幾章比較弱、遊戲裡對但卷上錯的題、該翻課本哪一段），也能寄信推薦孩子回去玩哪一關。「學習地圖」看每個知識點學會了沒。</td></tr>
      <tr><th>樂園公告</th><td>寄信鴿信給自己班的孩子（例如「這週先玩第三章」），孩子打開樂園就會收到。</td></tr>
      <tr><th>問題回報</th><td>孩子在遊戲裡按齒輪回報的問題。處理好之後，孩子下次登入會收到「你回報的問題處理囉」。</td></tr>
      <tr><th>使用指南</th><td>就是這一頁。</td></tr>
    </tbody></table>
  </section>

  <section class="panel guide">
    <h2><img class="hi" src="img/admin/students.webp" alt="">帶孩子的重點</h2>
    <ol class="gl">
      <li><b>一次 20–30 分鐘，一週 3–5 天</b>就夠，玩 30 分休息 10 分。建議先寫完功課再玩。</li>
      <li><b>先看紅色的</b>：細節頁的答對率不到 60% 會變紅，先陪孩子看那一章。</li>
      <li><b>錯了先問「你怎麼想的？」</b>，不要只看分數。遊戲裡答對不一定是真的懂，也可能是猜的。</li>
      <li><b>搭配課本</b>：遊戲照時代排，不一定跟學校進度同步，是課業的輔助，不是主要教材。</li>
      <li><b>新來的孩子</b>前七天照「新手手冊」走，一天一頁；總覽看得到他做到第幾頁。</li>
      <li><b>好幾天沒來</b>：用樂園公告寄一封信，或在總覽看他最後玩到哪。</li>
    </ol>
  </section>

  <section class="panel guide">
    <h2><img class="hi" src="img/admin/passport.webp" alt="">內容出處</h2>
    <p class="lead">學生畫面不放出處，免得像在讀課本；每座島的細節頁最下面都有完整的「內容出處」。</p>
    <table class="gtab"><tbody>
      <tr><th>島嶼開拓者</th><td>小五社會（108 課綱）。每章的圖鑑卡和「真的是這樣嗎？」都附出處，參考課綱與公開資料整理。過去篇照時代排；現在篇（漁村、規則小鎮、天空港、離島、明信片）對應地理和公民。</td></tr>
      <tr><th>守護異世界</th><td>2000 個基本英文字彙，從看得見的字（數字、身體、動物、顏色）慢慢到抽象的字；細節頁看得到每個字和認字、聽音、拼字三種題型的答對率。</td></tr>
      <tr><th>時光祕境島</th><td>小五自然（試營運中）。細節頁有每關的步驟和失誤紀錄。</td></tr>
    </tbody></table>
    <p class="tip">發現哪裡寫得不對，請到「問題回報」或遊戲裡的齒輪回報，我們會修正。</p>
  </section>

  <section class="panel guide">
    <h2><img class="hi" src="img/admin/settings.webp" alt="">常見問題</h2>
    <details><summary>孩子忘記密碼？</summary><p>我的班級 → 全班總覽 → 那個孩子的「重設密碼」。</p></details>
    <details><summary>孩子已經在試玩班（或別的班）了，還能加入我的班嗎？</summary><p>可以。孩子到樂園「我的資料」輸入你的班級代碼就會多加入一個班，原本的進度都在。建議家長開一個「家庭班」，就看得到自己孩子的總覽和細節頁。</p></details>
    <details><summary>代碼流出去了？</summary><p>班級資料裡「換一組代碼」，班上的人都還在；或把「開放加入」關掉。</p></details>
    <details><summary>某座島孩子點不進去？</summary><p>看「開放哪些島」有沒有勾；還在施工中的島會顯示施工中。</p></details>
  </section>`;
  $('[data-tour]', view).onclick = onTour;
}
