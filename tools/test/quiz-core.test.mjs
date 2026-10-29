// node tools/test/quiz-core.test.mjs
import assert from 'node:assert/strict';
import { kidStates, pickPaper, readSlot, DAY } from '../../js/quiz-core.js';

const kps = [
  { id: 'a', subject: 'soc', place: 'ch1', sort: 1 }, { id: 'b', subject: 'soc', place: 'ch1', sort: 2 },
  { id: 'c', subject: 'soc', place: 'ch2', sort: 3 }, { id: 'd', subject: 'sci', place: 'a-forest', sort: 4 },
];
const now = Date.parse('2026-10-29T08:00:00Z');
const d = (n) => new Date(now - n * DAY).toISOString();

// 不同天、不同題答對兩次＝學會；同一天兩次不算
let s = kidStates({ played: ['ch1'], game: [['a', true, d(5)]], ans: [['a', 'a-1', 1, d(1)], ['b', 'b-1', 1, d(1)], ['b', 'b-2', 1, d(1)]] }, kps, now);
assert.equal(s.a.state, 'learned');
assert.equal(s.b.state, 'seen');
assert.equal(s.c.state, 'new');
// 最近一次錯＝待加強
s = kidStates({ ans: [['a', 'a-1', 1, d(9)], ['a', 'a-2', 1, d(5)], ['a', 'a-3', 0, d(1)]] }, kps, now);
assert.equal(s.a.state, 'weak');
// 家長改回要加強：之前的都不算
s = kidStates({ ans: [['a', 'a-1', 1, d(9)], ['a', 'a-2', 1, d(5)]], marks: { a: d(2) } }, kps, now);
assert.equal(s.a.state, 'weak');
// 學會超過 30 天可以抽查
s = kidStates({ ans: [['a', 'a-1', 1, d(50)], ['a', 'a-2', 1, d(40)]] }, kps, now);
assert.equal(s.a.due, true);

// 挑題：答對過的原題不出、學會的不出
const bank = { kps, items: [
  { id: 'a-1', kp: 'a', kind: 'tf' }, { id: 'a-2', kp: 'a', kind: 'mc' }, { id: 'b-1', kp: 'b', kind: 'mc' }, { id: 'b-2', kp: 'b', kind: 'tf' },
  { id: 'c-1', kp: 'c', kind: 'mc' }, { id: 'c-2', kp: 'c', kind: 'who' }, { id: 'd-1', kp: 'd', kind: 'mc' },
] };
s = kidStates({ played: ['ch1'], ans: [['b', 'b-1', 1, d(1)], ['c', 'c-1', 0, d(1)]] }, kps, now);
const p = pickPaper(bank, s, { n: 4, subjects: new Set(['soc']), rand: () => 0.3 });
assert.ok(!p.some((x) => x.item === 'b-1'), '答對過的原題不出');
assert.ok(!p.some((x) => x.item === 'd-1'), '沒選的科目不出');
assert.equal(p.find((x) => x.item.startsWith('c-')).bucket, 'weak');
assert.equal(new Set(p.map((x) => x.item)).size, p.length, '同一題不出兩次');
assert.equal(p.length, 4);

assert.equal(readSlot({ got: 0, ms: 9000, kind: 'mc' }, true, true).code, 'ask');
assert.equal(readSlot({ got: 0, ms: 900, kind: 'mc' }, null, false).fast, true);
console.log('quiz-core ok');
