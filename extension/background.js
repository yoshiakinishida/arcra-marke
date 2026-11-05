const SERVER = 'http://127.0.0.1:3939';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// content script（Meet のページ）からはローカルサーバーに直接送れないため、ここで中継する
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'segments') {
    fetch(`${SERVER}/api/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Meeting-Notes': '1' },
      body: JSON.stringify(msg.payload),
    })
      .then(async (r) => sendResponse({ ok: r.ok, ...(await r.json().catch(() => ({}))) }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 非同期で応答する
  }
  return false;
});
