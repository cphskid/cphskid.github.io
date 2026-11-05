// 老師後台的新手引導：第一次進來跑一次導覽（聚光＋說明，可跳過），之後右上「？」選單隨時重看。
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
  { at: ['#tabs [data-view=home]'], title: '首頁', text: '你的班級、孩子在等你（家長）、這週該看的三件事。一個孩子可以同時加入好幾個班。' },
  { at: ['.classcards', '#new'], title: '班級卡片', text: '每個班一張卡：代碼在上面，按「看孩子」「出測驗卷」「班級設定」直接過去。還沒開班的話，先按「開新班」。' },
  { at: ['#tabs [data-view=kids]'], title: '孩子', text: '全班總覽（誰最近有來、在玩什麼、哪裡需要注意）和每天玩多久。點孩子的「詳情・管理」重設密碼、改暱稱。' },
  { at: ['#tabs [data-view=quiz]'], title: '測驗卷', text: '照孩子常錯的地方自動出一張卷，你再調整。孩子在樂園的「時光試煉島」作答，交卷後這裡看分析報告。' },
  { at: ['#tabs [data-view=settings]'], title: '設定', text: '班級代碼、開放哪些島、寵物島每天玩多久、上課時間桌寵休息、改自己的密碼，都在這裡。' },
  { at: ['#help'], title: '「？」選單', text: '使用指南、問題回報、功能建議、聯繫園長都在這裡，這段導覽也可以從這裡重看。' },
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
    <p class="lead">開好班之後，平常大概只要做三件事：在「孩子」頁看<b>總覽</b>誰沒來、點<b>細節頁</b>看哪裡常錯、偶爾看一下<b>每天玩多久</b>有沒有玩太久。</p>
  </section>

  <section class="panel guide">
    <h2><img class="hi" src="img/admin/class.webp" alt="">每個頁籤是做什麼的</h2>
    <table class="gtab"><tbody>
      <tr><th>首頁</th><td>你的班級卡片（代碼、人數）、開新班、家長和孩子連起來、這週該看的三件事。</td></tr>
      <tr><th>孩子</th><td><b>總覽</b>：最後活動、在玩什麼、需要注意，人多的班可以搜尋、分類、翻頁；每座島的「細節頁」看進度、答對率、常錯的地方。點「詳情・管理」重設密碼、改暱稱、設年級、移出。<b>每天玩多久</b>：全班每個人每天玩了幾分鐘，點名字看他每天去了哪些島。右上「寄信鴿信給孩子」寄信給自己班。</td></tr>
      <tr><th>測驗卷</th><td>出卷：照孩子在遊戲和之前的卷上錯的地方自動挑題，你再調整，可以出 10、20、30 題。孩子在樂園的「時光試煉島」作答。交卷後看分析報告（哪幾章比較弱、遊戲裡對但卷上錯的題、該翻課本哪一段），也能寄信推薦孩子回去玩哪一關。「學習地圖」看每個知識點學會了沒。家長開的家庭班，在「出過的卷」也看得到孩子在學校班寫過的卷（只能看）；學校老師看不到家庭班出的卷。</td></tr>
      <tr><th>設定</th><td>班級代碼、開放加入、班級資料、開放哪些島、寵物島（上課時間休息、每天可以玩幾分鐘）、改自己的密碼、送出建議。孩子綁了家長、家長也開了家庭班的話，開放的島和寵物島時間照家長的。</td></tr>
      <tr><th>右上「？」</th><td>重看導覽、使用指南（就是這一頁）、問題回報（班上孩子的回報、你送出的建議和回覆）、功能建議、聯繫園長 timepark@ciyulab.com。</td></tr>
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
      <li><b>好幾天沒來</b>：在「孩子」頁按「寄信鴿信給孩子」，或在總覽看他最後玩到哪。</li>
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
    <p class="tip">發現哪裡寫得不對，請按右上「？→ 功能建議」或遊戲裡的齒輪回報，我們會修正。</p>
  </section>

  <section class="panel guide">
    <h2><img class="hi" src="img/admin/settings.webp" alt="">常見問題</h2>
    <details open><summary>家長怎麼和孩子連起來？</summary><p>孩子在樂園下方功能列按「爸媽任務」（沒看到就先按「更多」）→「拿給爸媽看」，畫面會出現 QR 和 6 碼<b>家長碼</b>。家長用手機相機掃 QR 會直接開到後台，登入或建立家長帳號後自動連起來；不能掃的話，登入後台在<b>「首頁」最上面</b>輸入那 6 碼（老師帳號是最上面那一行「家長要和孩子連起來？」）。孩子還沒有帳號，就在同一個地方按「幫孩子開帳號」。家長碼 14 天內有效、用過一次就換新的；大人輸入後，要孩子在樂園按「是我的爸媽」才算連起來。孩子也可以在爸媽任務填爸媽的信箱寄邀請信，爸媽在信裡按確認就好。每個孩子最多連兩位家長；不認識的大人可以在孩子卡片的「連起來的大人」移除。</p></details>
    <details><summary>孩子忘記密碼？</summary><p>孩子 → 總覽 → 那個孩子的「詳情・管理」→「重設密碼」。為了安全，只有孩子<b>主要班級</b>的老師、綁定的家長或管理員可以改密碼和暱稱；孩子會收到一封信知道密碼被改過，連起來的爸媽也會收到通知信。和爸媽連起來的孩子，也可以自己在登入畫面按「忘記密碼？」，設新密碼的連結會寄到爸媽信箱。</p></details>
    <details><summary>孩子已經在公共交誼廳（或別的班）了，還能加入我的班嗎？</summary><p>可以。孩子到樂園「我的資料」輸入你的班級代碼就會多加入一個班，原本的進度都在。建議家長開一個「家庭班」，就看得到自己孩子的總覽和細節頁。</p></details>
    <details><summary>代碼流出去了？</summary><p>班級資料裡「換一組代碼」，班上的人都還在；或把「開放加入」關掉。</p></details>
    <details><summary>某座島孩子點不進去？</summary><p>看「開放哪些島」有沒有勾；還在施工中的島會顯示施工中。</p></details>
  </section>`;
  $('[data-tour]', view).onclick = onTour;
}
