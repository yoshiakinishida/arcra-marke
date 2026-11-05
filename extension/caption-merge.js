// 字幕ブロックの「前回のテキスト」と「今回のテキスト」を統合する。
// Meet の字幕は、話している間に後ろへ伸びたり、直前の語が修正されたり、
// 長くなると先頭が画面から削られたりするため、それぞれに対応する。
function mergeCaptionText(prev, next) {
  prev = (prev || '').trim();
  next = (next || '').trim();
  if (!prev) return next;
  if (!next || prev === next) return prev;
  if (next.startsWith(prev) || next.includes(prev)) return next; // 伸びた
  if (prev.startsWith(next)) return next; // 末尾が修正で短くなった
  if (prev.includes(next)) return prev; // 先頭が削られただけで新しい内容なし

  // 先頭が削られて、続きが伸びた: prev の末尾と next の先頭が重なる
  const max = Math.min(prev.length, next.length);
  for (let k = max; k >= 6; k--) {
    if (prev.endsWith(next.slice(0, k))) return prev + next.slice(k);
  }
  // 途中の語が修正された: 共通の先頭部分が長い
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
  if (p >= Math.min(prev.length, next.length) * 0.5) return next;
  // 先頭が削られ、かつ修正された: next の先頭を prev の中から探す
  const anchor = next.slice(0, Math.min(10, next.length));
  const idx = prev.lastIndexOf(anchor);
  if (anchor.length >= 4 && idx >= 0) return prev.slice(0, idx) + next;
  return prev + ' ' + next;
}

if (typeof module !== 'undefined') module.exports = { mergeCaptionText };
