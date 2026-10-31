// 時光試煉島：用表單改題目（老師後台的題庫審核用）。每種題型有自己的欄位，不用碰 JSON。
// body 的格式跟 tools/quiz-bank/kinds.mjs 一樣；短文圈選的空格在畫面上寫成【1】【2】，存檔時換回 {0}{1}。
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ABC = 'ABCDE';
const LIMIT = { opts: [3, 5], says: [3, 4], steps: [3, 5], cats: [2, 4], cards: [3, 6], blanks: [1, 4], bopts: [2, 4] };

const toMarks = (t) => String(t ?? '').replace(/\{(\d+)\}/g, (_, i) => `【${+i + 1}】`);
const fromMarks = (t) => t.replace(/【(\d+)】/g, (_, n) => `{${+n - 1}}`);

// 跟資料庫的 quiz_check 同一套規則，先在畫面上提醒
export function problems(kind, b) {
  const out = [], blank = (a) => a.some((x) => !String(x ?? '').trim());
  const dup = (a) => new Set(a.map((x) => String(x).trim())).size !== a.length;
  if ((b.q ?? '').trim().length < 4) out.push('題目太短');
  if ((b.why ?? '').trim().length < 6) out.push('要寫解析（為什麼）');
  if (/以上皆是|以上皆非/.test(b.q ?? '')) out.push('不要用「以上皆是／皆非」');
  if (kind === 'mc' || kind === 'multi') {
    if (blank(b.opts)) out.push('有選項是空的');
    else if (dup(b.opts)) out.push('有兩個選項一樣');
    if (kind === 'mc' && !Number.isInteger(b.a)) out.push('要勾一個正確答案');
    if (kind === 'multi' && (b.a.length < 2 || b.a.length >= b.opts.length)) out.push('多選題要勾 2 個以上的正確答案，而且不能全部都對');
  } else if (kind === 'who') {
    if (b.says.some((s) => !s.n.trim() || !s.t.trim())) out.push('每個人都要有名字和說的話');
    if (!Number.isInteger(b.a)) out.push('要勾哪一個人說得對');
  } else if (kind === 'order') {
    if (blank(b.steps)) out.push('有步驟是空的');
  } else if (kind === 'cat') {
    if (blank(b.cats)) out.push('有分類沒寫名字');
    if (b.cards.some((c) => !c.t.trim())) out.push('有卡片是空的');
    if (b.cards.some((c) => !Number.isInteger(c.c))) out.push('每張卡片都要選屬於哪一類');
  } else if (kind === 'cloze') {
    b.blanks.forEach((x, i) => {
      if (!b.text.includes(`【${i + 1}】`)) out.push(`短文裡少了【${i + 1}】`);
      if (blank(x.opts)) out.push(`第 ${i + 1} 格有選項是空的`);
      if (!Number.isInteger(x.a)) out.push(`第 ${i + 1} 格要勾正確答案`);
    });
  }
  return out;
}

// box：放表單的元素；it：{ kind, body, ver, status }；opt：{ preview(it), onSave(body), onCancel(), note }
export function openEditor(parent, it, opt) {
  const box = document.createElement('div');   // 每次開新的，事件才不會綁兩次
  parent.replaceChildren(box);
  const kind = it.kind;
  const b = structuredClone(it.body);
  if (kind === 'cloze') b.text = toMarks(b.text);

  const row = (inner, i, n, [min], extra = '') => `<div class="qe-row">${inner}${extra}
    <button type="button" class="qe-x" data-act="del" data-i="${i}" ${n <= min ? 'disabled' : ''} title="刪掉這一個">✕</button></div>`;
  const add = (what, n, [, max], label) => (n < max ? `<button type="button" class="ghost small" data-act="add" data-what="${what}">＋ ${label}</button>` : '');
  const field = (label, name, val, rows = 2, ph = '') => `<label class="qe-f">${label}<textarea data-f="${name}" rows="${rows}" placeholder="${ph}">${esc(val)}</textarea></label>`;

  function part() {
    if (kind === 'tf') return `<div class="qe-sec"><b>答案</b><div class="row">
      <label class="chip"><input type="radio" name="qe-tf" data-tf="1" ${b.a === true ? 'checked' : ''}>⭕ 對</label>
      <label class="chip"><input type="radio" name="qe-tf" data-tf="0" ${b.a === false ? 'checked' : ''}>❌ 不對</label></div></div>`;
    if (kind === 'mc' || kind === 'multi') return `<div class="qe-sec"><b>選項</b><small>${kind === 'mc' ? '在正確答案前面點一下（只能一個）' : '對的都要打勾（至少 2 個、不能全部）'}；孩子看到時順序會打亂。</small>
      ${b.opts.map((o, i) => row(`<label class="qe-ok">${kind === 'mc'
        ? `<input type="radio" name="qe-a" data-a="${i}" ${b.a === i ? 'checked' : ''}>`
        : `<input type="checkbox" data-a="${i}" ${b.a.includes(i) ? 'checked' : ''}>`}<span>${ABC[i]}</span></label>
        <input data-opt="${i}" value="${esc(o)}" maxlength="60">`, i, b.opts.length, LIMIT.opts)).join('')}
      ${add('opt', b.opts.length, LIMIT.opts, '加一個選項')}</div>`;
    if (kind === 'who') return `<div class="qe-sec"><b>誰說的話</b><small>在說得對的那個人前面點一下。</small>
      ${b.says.map((s, i) => row(`<label class="qe-ok"><input type="radio" name="qe-a" data-a="${i}" ${b.a === i ? 'checked' : ''}></label>
        <input class="qe-name" data-sn="${i}" value="${esc(s.n)}" maxlength="10" placeholder="名字">
        <input data-st="${i}" value="${esc(s.t)}" maxlength="80" placeholder="他說的話">`, i, b.says.length, LIMIT.says)).join('')}
      ${add('say', b.says.length, LIMIT.says, '加一個人')}</div>`;
    if (kind === 'order') return `<div class="qe-sec"><b>步驟（照正確的順序，從上到下）</b><small>孩子看到時會打亂，要照這個順序點。</small>
      ${b.steps.map((s, i) => row(`<span class="qe-n">${i + 1}</span><input data-step="${i}" value="${esc(s)}" maxlength="60">`, i, b.steps.length, LIMIT.steps,
        `<button type="button" class="qe-x" data-act="up" data-i="${i}" ${i ? '' : 'disabled'} title="往上移">↑</button><button type="button" class="qe-x" data-act="down" data-i="${i}" ${i < b.steps.length - 1 ? '' : 'disabled'} title="往下移">↓</button>`)).join('')}
      ${add('step', b.steps.length, LIMIT.steps, '加一個步驟')}</div>`;
    if (kind === 'cat') return `<div class="qe-sec"><b>分類</b>
      ${b.cats.map((c, i) => row(`<span class="qe-n">${i + 1}</span><input data-cat="${i}" value="${esc(c)}" maxlength="20">`, i, b.cats.length, LIMIT.cats)).join('')}
      ${add('cat', b.cats.length, LIMIT.cats, '加一類')}</div>
      <div class="qe-sec"><b>卡片和它屬於哪一類</b>
      ${b.cards.map((c, i) => row(`<input data-card="${i}" value="${esc(c.t)}" maxlength="40">
        <select data-cc="${i}"><option value="">選一類…</option>${b.cats.map((t, k) => `<option value="${k}" ${c.c === k ? 'selected' : ''}>${esc(t || `第 ${k + 1} 類`)}</option>`).join('')}</select>`, i, b.cards.length, LIMIT.cards)).join('')}
      ${add('card', b.cards.length, LIMIT.cards, '加一張卡片')}</div>`;
    if (kind === 'cloze') return `<div class="qe-sec">${field('短文（空格寫成【1】【2】…）', 'text', b.text, 4)}</div>
      ${b.blanks.map((x, i) => `<div class="qe-sec"><div class="qe-row"><b>第【${i + 1}】格的選項</b><span class="spacer"></span>
        <button type="button" class="qe-x" data-act="del" data-i="${i}" ${b.blanks.length <= LIMIT.blanks[0] ? 'disabled' : ''} title="刪掉這一格">✕ 刪這一格</button></div>
        <small>在正確答案前面點一下。</small>
        ${x.opts.map((o, k) => `<div class="qe-row"><label class="qe-ok"><input type="radio" name="qe-b${i}" data-ba="${i},${k}" ${x.a === k ? 'checked' : ''}></label>
          <input data-bo="${i},${k}" value="${esc(o)}" maxlength="30">
          <button type="button" class="qe-x" data-act="delbo" data-i="${i},${k}" ${x.opts.length <= LIMIT.bopts[0] ? 'disabled' : ''} title="刪掉這個選項">✕</button></div>`).join('')}
        ${x.opts.length < LIMIT.bopts[1] ? `<button type="button" class="ghost small" data-act="addbo" data-i="${i}">＋ 加一個選項</button>` : ''}</div>`).join('')}
      ${add('blank', b.blanks.length, LIMIT.blanks, '加一個空格（會在短文最後補上記號）')}`;
    return '';
  }

  function render() {
    box.innerHTML = `<div class="qe">
      ${opt.note ? `<p class="tip">${opt.note}</p>` : ''}
      ${field('題目', 'q', b.q, 2)}
      ${part()}
      ${field('解析（孩子交卷後看到的「為什麼」）', 'why', b.why, 2)}
      <details class="qe-pv"><summary>看看改完的樣子</summary><div data-pv></div></details>
      <ul class="qe-err" data-err></ul>
      <div class="row"><button type="button" class="btn small go" data-act="save">${opt.saveLabel ?? '存檔'}</button><button type="button" class="ghost small" data-act="cancel">取消</button></div>
    </div>`;
    refresh();
  }
  const out = () => (kind === 'cloze' ? { ...b, text: fromMarks(b.text) } : structuredClone(b));
  function refresh() {
    const errs = problems(kind, b);
    box.querySelector('[data-err]').innerHTML = errs.map((e) => `<li>${esc(e)}</li>`).join('');
    box.querySelector('[data-act=save]').disabled = errs.length > 0;
    const pv = box.querySelector('[data-pv]');
    if (opt.preview && box.querySelector('.qe-pv').open) pv.innerHTML = errs.length ? '<p class="tip">先把下面紅字的地方補好。</p>' : opt.preview({ ...it, body: out() });
  }

  box.addEventListener('toggle', refresh, true);
  box.addEventListener('input', (e) => {
    const t = e.target, d = t.dataset;
    if (d.f) b[d.f] = t.value;
    else if (d.opt) b.opts[+d.opt] = t.value;
    else if (d.sn) b.says[+d.sn].n = t.value;
    else if (d.st) b.says[+d.st].t = t.value;
    else if (d.step) b.steps[+d.step] = t.value;
    else if (d.cat) { b.cats[+d.cat] = t.value; box.querySelectorAll(`[data-cc] option[value="${d.cat}"]`).forEach((o) => { o.textContent = t.value || `第 ${+d.cat + 1} 類`; }); }
    else if (d.card) b.cards[+d.card].t = t.value;
    else if (d.bo) { const [i, k] = d.bo.split(',').map(Number); b.blanks[i].opts[k] = t.value; }
    else return;
    refresh();
  });
  box.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (d.tf) b.a = d.tf === '1';
    else if (d.a !== undefined && kind === 'multi') b.a = [...box.querySelectorAll('[data-a]:checked')].map((x) => +x.dataset.a);
    else if (d.a !== undefined) b.a = +d.a;
    else if (d.cc) b.cards[+d.cc].c = t.value === '' ? null : +t.value;
    else if (d.ba) { const [i, k] = d.ba.split(',').map(Number); b.blanks[i].a = k; }
    else return;
    refresh();
  });
  // 刪掉第 i 個時，答案的編號跟著往前移
  const shift = (v, i) => (v === i ? null : v > i ? v - 1 : v);
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act, i = btn.dataset.i;
    if (act === 'cancel') return opt.onCancel?.();
    if (act === 'save') {
      btn.disabled = true;
      const body = out();
      for (const k of Object.keys(body)) if (typeof body[k] === 'string') body[k] = body[k].trim();
      try { await opt.onSave(body); } finally { btn.disabled = false; }
      return;
    }
    if (act === 'add') {
      const w = btn.dataset.what;
      if (w === 'opt') b.opts.push('');
      if (w === 'say') b.says.push({ n: '', t: '' });
      if (w === 'step') b.steps.push('');
      if (w === 'cat') b.cats.push('');
      if (w === 'card') b.cards.push({ t: '', c: null });
      if (w === 'blank') { b.blanks.push({ opts: ['', ''], a: null }); b.text += `【${b.blanks.length}】`; }
    } else if (act === 'del') {
      const n = +i;
      if (kind === 'mc' || kind === 'multi') { b.opts.splice(n, 1); b.a = kind === 'mc' ? shift(b.a, n) : b.a.filter((x) => x !== n).map((x) => (x > n ? x - 1 : x)); }
      if (kind === 'who') { b.says.splice(n, 1); b.a = shift(b.a, n); }
      if (kind === 'order') b.steps.splice(n, 1);
      if (kind === 'cat') {
        if (btn.closest('.qe-sec').querySelector('[data-cat]')) { b.cats.splice(n, 1); b.cards.forEach((c) => { c.c = shift(c.c, n); }); }
        else b.cards.splice(n, 1);
      }
      if (kind === 'cloze') {   // 拿掉這一格的記號，後面的編號往前補
        b.blanks.splice(n, 1);
        b.text = b.text.replace(/【(\d+)】/g, (m, k) => (+k === n + 1 ? '' : +k > n + 1 ? `【${+k - 1}】` : m));
      }
    } else if (act === 'up' || act === 'down') {
      const n = +i, m = act === 'up' ? n - 1 : n + 1;
      [b.steps[n], b.steps[m]] = [b.steps[m], b.steps[n]];
    } else if (act === 'addbo') b.blanks[+i].opts.push('');
    else if (act === 'delbo') { const [x, k] = i.split(',').map(Number); b.blanks[x].opts.splice(k, 1); b.blanks[x].a = shift(b.blanks[x].a, k); }
    const open = box.querySelector('.qe-pv')?.open;
    render();
    if (open) { box.querySelector('.qe-pv').open = true; refresh(); }
  });
  render();
}
