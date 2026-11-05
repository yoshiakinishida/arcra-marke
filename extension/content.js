// Google Meet の字幕（CC）を読み取り、ローカルの商談メモサーバーに送る。
// Meet の画面構成は予告なく変わるため、読み取り方を複数用意している。
// 動かなくなったら、下の SELECTORS を Meet の現在の HTML に合わせて直す。
(() => {
  if (window.__meetingNotesLoaded) return;
  window.__meetingNotesLoaded = true;

  const POLL_MS = 1500;
  const FLUSH_MS = 5000;

  const SELECTORS = {
    // 字幕エリア。aria-label（表示言語により「字幕」/ "Captions"）を最優先で探す
    region: [
      '[role="region"][aria-label="字幕"]',
      '[role="region"][aria-label="Captions"]',
      '[role="region"][aria-label*="字幕"]',
      '[role="region"][aria-label*="aption"]',
      'div[jsname="dsyhDe"]', // 予備（過去の Meet のクラス名など）
      '.a4cQT',
    ],
    block: ['.nMcdL', '.TBMuR'], // 話者ごとの字幕のかたまり（予備）
    speaker: ['.NWpY1d', '.zs7s8d', '.KcIKyf'],
    text: ['.ygicle', '.bh44bd', '.iTTPOb'],
  };

  const loadId = Date.now().toString(36);
  let counter = 0;
  const states = new WeakMap(); // 字幕ブロック要素 → 記録状態
  const dirty = new Set();
  let lastSpeaker = '';
  let captionsSeenAt = 0;
  let serverOk = null;
  let sentCount = 0;

  const meetingCode = () => {
    const m = location.pathname.match(/^\/([a-z]{3,}-[a-z]{3,}-[a-z]{3,})(?:$|[/?])/);
    return m ? m[1] : null;
  };

  const first = (root, list) => {
    for (const sel of list) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const lineCount = (el) => (el.innerText || '').split('\n').filter((s) => s.trim()).length;

  function findBlocks(region) {
    for (const sel of SELECTORS.block) {
      const found = region.querySelectorAll(sel);
      if (found.length) return [...found];
    }
    // 各字幕ブロックには話者のアバター画像がある。画像から親をたどり、
    // 「話者名」と「字幕本文」の2行以上を含む最も内側の要素を「話者ごとのかたまり」とみなす
    const imgs = [...region.querySelectorAll('img')];
    if (imgs.length) {
      const blocks = new Set();
      for (const img of imgs) {
        let el = img;
        while (lineCount(el) < 2 && el.parentElement && el.parentElement !== region &&
               el.parentElement.querySelectorAll('img').length === 1) {
          el = el.parentElement;
        }
        if (lineCount(el) >= 2) blocks.add(el); // 本文がまだ出ていないブロックは次回に回す
      }
      return [...blocks];
    }
    // 画像がない場合: 子要素が1つだけのラッパーをたどり、最初に枝分かれした階層をかたまりとみなす
    let node = region;
    while (node.children.length === 1) node = node.children[0];
    return [...node.children];
  }

  function parseBlock(el) {
    const sp = first(el, SELECTORS.speaker);
    const tx = first(el, SELECTORS.text);
    if (tx) return { speaker: sp ? sp.innerText.trim() : '', text: tx.innerText.replace(/\s*\n\s*/g, ' ').trim() };
    const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    if (lines.length === 1) return { speaker: '', text: lines[0] };
    return { speaker: lines[0], text: lines.slice(1).join(' ') };
  }

  function poll() {
    if (!meetingCode()) return;
    const region = first(document, SELECTORS.region);
    if (!region) return updateBadge();
    for (const el of findBlocks(region)) {
      if (el.querySelector('button') && !(el.innerText || '').trim()) continue;
      const parsed = parseBlock(el);
      if (!parsed || !parsed.text) continue;
      captionsSeenAt = Date.now();
      let st = states.get(el);
      if (!st) {
        st = { id: `${loadId}-${++counter}`, speaker: '', text: '', firstSeen: Date.now() };
        states.set(el, st);
      }
      const speaker = parsed.speaker || st.speaker || lastSpeaker;
      const merged = mergeCaptionText(st.text, parsed.text);
      if (merged !== st.text || speaker !== st.speaker) {
        st.text = merged;
        st.speaker = speaker;
        dirty.add(st);
      }
      if (speaker) lastSpeaker = speaker;
    }
    updateBadge();
  }

  function flush() {
    const code = meetingCode();
    if (!code || !dirty.size) return;
    const batch = [...dirty];
    dirty.clear();
    const payload = {
      meetingCode: code,
      title: document.title.replace(/^Meet\s*[-–:]\s*/, '').trim(),
      url: location.origin + location.pathname,
      segments: batch.map(({ id, speaker, text, firstSeen }) => ({ id, speaker, text, firstSeen })),
    };
    try {
      chrome.runtime.sendMessage({ type: 'segments', payload }, (res) => {
        const ok = !chrome.runtime.lastError && res && res.ok;
        serverOk = !!ok;
        if (ok) sentCount = res.segmentCount;
        else batch.forEach((s) => dirty.add(s)); // 失敗したら次回に再送
        updateBadge();
      });
    } catch (e) {
      // 拡張機能を再読み込みした直後など。ページを再読み込みすれば直る
      serverOk = false;
      batch.forEach((s) => dirty.add(s));
      updateBadge('拡張機能が更新されました。Meet のページを再読み込みしてください');
    }
  }

  // 画面左下に小さな状態表示を出す
  let badge;
  function updateBadge(override) {
    if (!meetingCode()) return;
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText =
        'position:fixed;left:12px;bottom:84px;z-index:2147483647;padding:4px 10px;border-radius:99px;' +
        'font:12px/1.5 -apple-system,"Hiragino Sans",sans-serif;color:#fff;background:rgba(32,33,36,.85);pointer-events:none;';
      document.body.appendChild(badge);
    }
    let text;
    let color = '#9aa0a6';
    if (override) text = override;
    else if (serverOk === false) { text = '商談メモ: ローカルサーバーに接続できません'; color = '#f28b82'; }
    else if (Date.now() - captionsSeenAt > 60000) { text = '商談メモ: 字幕（CC）をオンにすると記録します'; color = '#fdd663'; }
    else { text = `商談メモ: 記録中（${sentCount}件）`; color = '#81c995'; }
    badge.innerHTML = '';
    const dot = document.createElement('span');
    dot.textContent = '● ';
    dot.style.color = color;
    badge.append(dot, document.createTextNode(text));
  }

  setInterval(poll, POLL_MS);
  setInterval(flush, FLUSH_MS);
  window.addEventListener('pagehide', flush);
})();
