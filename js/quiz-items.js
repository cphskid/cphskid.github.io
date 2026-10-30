// 時光試煉島的題目畫面：孩子作答（/quiz/）和老師看報告（後台）共用。
// item＝{ kind, show }，show 是伺服器洗過順序、拿掉答案的題目（quiz_public）。
// 作答 resp 一律用「畫面上的順序」：
//   tf true/false、mc/who 第幾個、multi [第幾個…]、order [依序點的第幾個…]、cat [每張卡選第幾類…]、cloze [每格選第幾個…]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ABC = 'ABCDE';

export const KIND_NAME = { tf: '是非', mc: '選擇', who: '誰說得對', multi: '多選', order: '排順序', cat: '分類', cloze: '短文圈選' };
const HOW = {
  tf: '說得對按「對」，說得不對按「不對」。',
  mc: '選一個最好的答案。',
  who: '哪一個人說得對？選一個。',
  multi: '可以選很多個，對的都要選。',
  order: '照順序一個一個點，點錯了按「重排」。',
  cat: '每張卡片選它屬於哪一類。',
  cloze: '每個空格選一個最合適的。',
};

// 答完了沒（每一格都有選）
export function answered(kind, show, resp) {
  if (resp === undefined || resp === null) return false;
  if (kind === 'multi') return Array.isArray(resp) && resp.length > 0;
  if (kind === 'order') return Array.isArray(resp) && resp.length === show.steps.length;
  if (kind === 'cat') return Array.isArray(resp) && show.cards.every((_, i) => Number.isInteger(resp[i]));
  if (kind === 'cloze') return Array.isArray(resp) && show.blanks.every((_, i) => Number.isInteger(resp[i]));
  return true;
}

// 作答畫面：回傳一個元素；每次改答案呼叫 onChange(resp)
export function renderAsk(item, resp, onChange) {
  const { kind, show } = item;
  const box = document.createElement('div');
  box.className = `qz-ask k-${kind}`;
  let r = resp == null ? null : structuredClone(resp);
  const set = (v) => { r = v; onChange(r); paint(); };
  function paint() {
    let body = '';
    if (kind === 'tf') {
      body = `<div class="qz-tf">
        <button type="button" class="qz-opt big${r === true ? ' on' : ''}" data-v="1"><b>⭕</b>對</button>
        <button type="button" class="qz-opt big${r === false ? ' on' : ''}" data-v="0"><b>❌</b>不對</button></div>`;
    } else if (kind === 'mc' || kind === 'multi') {
      const on = (i) => (kind === 'mc' ? r === i : Array.isArray(r) && r.includes(i));
      body = `<div class="qz-opts">${show.opts.map((o, i) => `<button type="button" class="qz-opt${on(i) ? ' on' : ''}${kind === 'multi' ? ' box' : ''}" data-i="${i}">
        <b>${kind === 'multi' ? (on(i) ? '☑' : '☐') : ABC[i]}</b><span>${esc(o)}</span></button>`).join('')}</div>`;
    } else if (kind === 'who') {
      body = `<div class="qz-who">${show.says.map((s, i) => `<button type="button" class="qz-say${r === i ? ' on' : ''}" data-i="${i}">
        <b>${esc(s.n)}</b><span>「${esc(s.t)}」</span></button>`).join('')}</div>`;
    } else if (kind === 'order') {
      const seq = Array.isArray(r) ? r : [];
      body = `<div class="qz-order">${show.steps.map((s, i) => {
        const n = seq.indexOf(i);
        return `<button type="button" class="qz-opt${n >= 0 ? ' on' : ''}" data-i="${i}"><b>${n >= 0 ? n + 1 : '・'}</b><span>${esc(s)}</span></button>`;
      }).join('')}</div><button type="button" class="qz-reset" ${seq.length ? '' : 'disabled'}>↺ 重排</button>`;
    } else if (kind === 'cat') {
      const a = Array.isArray(r) ? r : [];
      body = `<div class="qz-cat">${show.cards.map((c, i) => `<div class="qz-card"><p>${esc(c)}</p><div class="qz-chips">
        ${show.cats.map((t, k) => `<button type="button" class="qz-chip${a[i] === k ? ' on' : ''}" data-card="${i}" data-k="${k}">${esc(t)}</button>`).join('')}
        </div></div>`).join('')}</div>`;
    } else if (kind === 'cloze') {
      const a = Array.isArray(r) ? r : [];
      const text = esc(show.text).replace(/\{(\d+)\}/g, (_, i) => {
        const v = a[+i];
        return `<span class="qz-blank${Number.isInteger(v) ? ' on' : ''}">（${+i + 1}）${Number.isInteger(v) ? esc(show.blanks[+i][v]) : '＿＿＿'}</span>`;
      });
      body = `<p class="qz-passage">${text}</p>${show.blanks.map((opts, i) => `<div class="qz-card"><p>（${i + 1}）</p><div class="qz-chips">
        ${opts.map((o, k) => `<button type="button" class="qz-chip${a[i] === k ? ' on' : ''}" data-card="${i}" data-k="${k}">${esc(o)}</button>`).join('')}
        </div></div>`).join('')}`;
    }
    box.innerHTML = `<p class="qz-q">${esc(show.q)}</p><p class="qz-how">${HOW[kind]}</p>${body}`;
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (kind === 'tf') return set(b.dataset.v === '1');
    if (b.classList.contains('qz-reset')) return set(null);
    if (kind === 'mc' || kind === 'who') return set(+b.dataset.i);
    if (kind === 'multi') {
      const a = new Set(Array.isArray(r) ? r : []), i = +b.dataset.i;
      a.has(i) ? a.delete(i) : a.add(i);
      return set([...a].sort((x, y) => x - y));
    }
    if (kind === 'order') {
      const seq = Array.isArray(r) ? [...r] : [], i = +b.dataset.i, at = seq.indexOf(i);
      if (at >= 0) seq.splice(at); else seq.push(i);   // 點已經排過的：從它開始後面的都拿掉
      return set(seq.length ? seq : null);
    }
    if (kind === 'cat' || kind === 'cloze') {
      const n = kind === 'cat' ? show.cards.length : show.blanks.length;
      const a = Array.isArray(r) ? [...r] : Array(n).fill(null);
      a[+b.dataset.card] = +b.dataset.k;
      return set(a);
    }
  });
  paint();
  return box;
}

// 把一個答案說成文字（看結果用）
export function say(kind, show, v) {
  if (v === undefined || v === null) return '（沒有作答）';
  if (kind === 'tf') return v === true ? '對' : v === false ? '不對' : '（沒有作答）';
  if (kind === 'mc') return show.opts[v] ?? '（沒有作答）';
  if (kind === 'who') return show.says[v] ? `${show.says[v].n}：「${show.says[v].t}」` : '（沒有作答）';
  if (kind === 'multi') return (Array.isArray(v) && v.length) ? v.map((i) => show.opts[i]).join('、') : '（沒有作答）';
  if (kind === 'order') return Array.isArray(v) ? v.map((i) => show.steps[i]).join(' → ') : '（沒有作答）';
  if (kind === 'cat') return Array.isArray(v) ? show.cards.map((c, i) => `${c}：${show.cats[v[i]] ?? '？'}`).join('；') : '（沒有作答）';
  if (kind === 'cloze') return Array.isArray(v) ? show.blanks.map((o, i) => `（${i + 1}）${o[v[i]] ?? '？'}`).join('、') : '（沒有作答）';
  return '';
}

// 一題的結果（孩子看結果、老師看報告都用）。x＝{ kind, show, resp, got, key, why, fix, fix_got }
export function resultHtml(x, n, { flag = false } = {}) {
  const got = Number(x.got ?? 0);
  const mark = got >= 1 ? 'ok' : got > 0 ? 'part' : 'no';
  const fixed = x.fix_got !== undefined && x.fix_got !== null;
  return `<li class="qz-res ${mark}">
    <div class="qz-res-h"><b class="qz-no">${n}</b><span class="qz-kind">${KIND_NAME[x.kind]}</span>
      <span class="qz-mark">${got >= 1 ? '✔ 答對' : got > 0 ? `△ 對了 ${Math.round(got * 100)}%` : '✘ 答錯'}</span>
      ${fixed ? `<span class="qz-fixed ${x.fix_got >= 1 ? 'ok' : ''}">訂正${x.fix_got >= 1 ? '改對了' : '還沒全對'}</span>` : ''}</div>
    <p class="qz-q">${esc(x.show.q)}</p>
    ${x.kind === 'cloze' ? `<p class="qz-passage small">${esc(x.show.text).replace(/\{(\d+)\}/g, (_, i) => `（${+i + 1}）＿＿`)}</p>` : ''}
    ${got < 1 ? `<p class="qz-mine">你的答案：${esc(say(x.kind, x.show, x.resp))}</p>` : ''}
    <p class="qz-key">正確答案：${esc(say(x.kind, x.show, x.key))}</p>
    ${x.why ? `<p class="qz-why"><b>💡 為什麼：</b>${esc(x.why)}</p>` : ''}
    ${flag ? `<button type="button" class="qz-flag" data-flag="${x.pos}">這題怪怪的？</button>` : ''}
  </li>`;
}
