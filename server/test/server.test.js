const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.MATERIALS_DIR = path.join(tmp, 'materials');
process.env.DRIVE_DIR = path.join(tmp, 'drive');
process.env.CLAUDE_BIN = path.join(__dirname, 'fake-claude.js');
process.env.ANTHROPIC_API_KEY = 'should-not-be-passed';
fs.mkdirSync(process.env.MATERIALS_DIR);
fs.writeFileSync(path.join(process.env.MATERIALS_DIR, 'service.md'), '# サービスA\n月額10万円');

const config = require('../src/config');
const { createApp } = require('../src/server');
const { proposalPrompt, loadMaterials } = require('../src/prompts');

let app, base;
test.before(async () => {
  app = createApp(config);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(() => app.server.close());

const H = { 'Content-Type': 'application/json', 'X-Meeting-Notes': '1' };
const post = (p, body, headers = H) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body || {}) });
const waitIdle = async (id) => {
  for (let i = 0; i < 100; i++) {
    const s = await (await fetch(`${base}/api/sessions/${encodeURIComponent(id)}`)).json();
    if (!s.busy) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
};

test('独自ヘッダーなしの書き込みは拒否', async () => {
  const r = await post('/api/segments', { meetingCode: 'abc-defg-hij' }, { 'Content-Type': 'text/plain' });
  assert.strictEqual(r.status, 403);
});

test('字幕の受信 → 要約 → 議事録・提案スライド', async () => {
  let r = await post('/api/segments', {
    meetingCode: 'abc-defg-hij', title: 'テスト商談',
    segments: [
      { id: 'x-1', speaker: '山田', text: '営業管理に課題があります', firstSeen: Date.now() },
      { id: 'x-2', speaker: 'あなた', text: '詳しく教えてください', firstSeen: Date.now() + 1 },
    ],
  });
  const j = await r.json();
  assert.strictEqual(j.segmentCount, 2);
  // 同じ ID の更新は上書き
  r = await post('/api/segments', { meetingCode: 'abc-defg-hij', segments: [{ id: 'x-2', speaker: 'あなた', text: '詳しく教えてください。予算は？' }] });
  assert.strictEqual((await r.json()).segmentCount, 2);

  // 間隔前は自動要約しない
  const s0 = app.store.get(j.sessionId);
  app.tick();
  assert.strictEqual(s0.summaries.length, 0);
  // 間隔が過ぎたら自動要約
  app.tick(Date.now() + 11 * 60 * 1000);
  let s = await waitIdle(j.sessionId);
  assert.strictEqual(s.summaries.length, 1);
  assert.match(s.summaries[0].markdown, /営業管理に課題があります/);
  // 新しい字幕がなければ要約しない
  app.tick(Date.now() + 30 * 60 * 1000);
  s = await waitIdle(j.sessionId);
  assert.strictEqual(s.summaries.length, 1);

  await post(`/api/sessions/${j.sessionId}/settings`, { customer: 'テスト株式会社', mode: 'offline' });
  r = await post(`/api/sessions/${j.sessionId}/finish`);
  assert.strictEqual(r.status, 202);
  s = await waitIdle(j.sessionId);
  assert.strictEqual(s.status, 'finished', s.lastError);
  assert.match(s.minutes.markdown, /議事録/);
  assert.strictEqual(s.proposal.json.slides.length, 2);
  const pptx = await fetch(base + s.proposal.download);
  assert.strictEqual(pptx.status, 200);
  const buf = Buffer.from(await pptx.arrayBuffer());
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  assert.ok(fs.existsSync(s.proposal.drivePath));
  assert.ok(fs.existsSync(path.join(s.folder, 'minutes.md')));
  assert.ok(fs.existsSync(path.join(s.folder, 'summary-01.md')));
});

test('自社資料がプロンプトに入る', () => {
  const mats = loadMaterials(process.env.MATERIALS_DIR);
  assert.match(mats, /月額10万円/);
  const p = proposalPrompt({ title: 't', createdAt: Date.now(), mode: 'online', customer: '' }, '議事録', mats, config);
  assert.match(p, /月額10万円/);
});
