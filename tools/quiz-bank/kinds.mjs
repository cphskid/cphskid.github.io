// 題型的小工具：把題目寫成資料庫要的 body（答案標在原本的順序上）。
export const tf = (q, a, why) => ({ kind: 'tf', body: { q, a, why } });
export const mc = (q, opts, a, why) => ({ kind: 'mc', body: { q, opts, a, why } });
export const who = (q, says, a, why) => ({ kind: 'who', body: { q, says: says.map(([n, t]) => ({ n, t })), a, why } });
export const multi = (q, opts, a, why) => ({ kind: 'multi', body: { q, opts, a, why } });
export const order = (q, steps, why) => ({ kind: 'order', body: { q, steps, why } });
export const cat = (q, cats, cards, why) => ({ kind: 'cat', body: { q, cats, cards: cards.map(([t, c]) => ({ t, c })), why } });
export const cloze = (q, text, blanks, why) => ({ kind: 'cloze', body: { q, text, blanks: blanks.map(([opts, a]) => ({ opts, a })), why } });
