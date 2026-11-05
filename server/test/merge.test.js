const test = require('node:test');
const assert = require('node:assert');
const { mergeCaptionText: m } = require('../../extension/caption-merge.js');

test('伸びた字幕はそのまま置き換え', () => assert.strictEqual(m('今日は', '今日はよろしく'), '今日はよろしく'));
test('末尾の修正で短くなる', () => assert.strictEqual(m('予算は五百万円で', '予算は五百万'), '予算は五百万'));
test('途中の語の修正', () => assert.strictEqual(m('来月の十日までに見積もり', '来月の十日までにお見積もりを'), '来月の十日までにお見積もりを'));
test('先頭が削られて続きが伸びる', () => {
  const prev = 'まず現状の課題についてお伺いしたいのですが営業の管理はどうされていますか';
  const next = '営業の管理はどうされていますかエクセルで管理しています';
  assert.strictEqual(m(prev, next), prev + 'エクセルで管理しています');
});
test('先頭が削られただけ', () => assert.strictEqual(m('あいうえおかきくけこ', 'かきくけこ'), 'あいうえおかきくけこ'));
test('空', () => { assert.strictEqual(m('', 'abc'), 'abc'); assert.strictEqual(m('abc', ''), 'abc'); });
