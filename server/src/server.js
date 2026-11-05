'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Store } = require('./store');
const { runClaude } = require('./claude');
const prompts = require('./prompts');
const { buildPptx } = require('./slides');

function createApp(cfg = config, deps = {}) {
  const store = deps.store || new Store(cfg);
  const claude = deps.runClaude || runClaude;
  const pptx = deps.buildPptx || buildPptx;
  const intervalMs = cfg.intervalMin * 60 * 1000;

  // ---------- 要約・議事録・提案 ----------
  async function summarize(s, { force = false } = {}) {
    if (s.busy) return { skipped: 'busy' };
    const since = s.lastSummaryCutoff || 0;
    const segs = store.segmentsSince(s, since);
    if (!segs.length) return { skipped: 'no-new-captions' };
    const cutoff = Date.now();
    const prev = [...s.summaries].reverse().find((x) => x.markdown);
    s.busy = 'summary';
    try {
      const md = await claude({ prompt: prompts.summaryPrompt(s, segs, prev && prev.markdown, cfg), model: cfg.summaryModel });
      const index = s.summaries.length + 1;
      s.summaries.push({ index, createdAt: cutoff, from: segs[0].firstSeen, to: cutoff, markdown: md, manual: force });
      s.lastSummaryCutoff = cutoff;
      s.lastSummaryAt = cutoff;
      s.lastError = null;
      store.writeFile(s, `summary-${String(index).padStart(2, '0')}.md`, md + '\n');
      return { ok: true, index };
    } catch (e) {
      s.lastError = `要約に失敗: ${e.message}`;
      s.retryAt = Date.now() + 2 * 60 * 1000;
      console.error(s.lastError);
      return { error: e.message };
    } finally {
      s.busy = null;
      store.save(s);
    }
  }

  const safeName = (t) => String(t).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

  function copyToDrive(s, src, name) {
    if (!cfg.driveDir) return null;
    try {
      fs.mkdirSync(cfg.driveDir, { recursive: true });
      const dest = path.join(cfg.driveDir, name);
      fs.copyFileSync(src, dest);
      return dest;
    } catch (e) {
      s.lastError = `Google ドライブのフォルダへのコピーに失敗: ${e.message}`;
      return null;
    }
  }

  async function makeProposal(s, minutes) {
    s.busy = 'proposal';
    store.save(s);
    const materials = prompts.loadMaterials(cfg.materialsDir);
    let proposal;
    let raw = await claude({ prompt: prompts.proposalPrompt(s, minutes, materials, cfg), model: cfg.proposalModel });
    try {
      proposal = prompts.parseProposal(raw);
    } catch (e) {
      store.writeFile(s, 'proposal-raw.txt', raw);
      raw = await claude({
        prompt: `次のテキストを、指定どおりの JSON（title, subtitle, slides[{title, lead, bullets, notes}]）だけに整形して出力してください。\n\n${raw}`,
        model: cfg.summaryModel,
      });
      proposal = prompts.parseProposal(raw);
    }
    store.writeFile(s, 'proposal.json', JSON.stringify(proposal, null, 2));
    const fileName = `提案書_${safeName(s.customer || s.title)}_${s.id.slice(0, 8)}.pptx`;
    const pptxPath = path.join(store.sessionDir(s), 'proposal.pptx');
    await pptx(proposal, pptxPath);
    s.proposal = { createdAt: Date.now(), json: proposal, fileName, drivePath: copyToDrive(s, pptxPath, fileName) };
  }

  async function finish(s) {
    if (s.busy) return { skipped: 'busy' };
    if (!s.segments.length) return { error: '字幕がまだ記録されていません' };
    s.status = 'finishing';
    s.lastError = null;
    try {
      s.busy = 'minutes';
      store.save(s);
      const minutes = await claude({ prompt: prompts.minutesPrompt(s, cfg), model: cfg.minutesModel });
      s.minutes = { createdAt: Date.now(), markdown: minutes };
      if (s.type === 'internal') s.proposal = null;
      store.writeFile(s, 'minutes.md', minutes + '\n');

      const minutesName = `${s.type === 'internal' ? '議事録' : '商談議事録'}_${safeName(s.type === 'internal' ? s.title : s.customer || s.title)}_${s.id.slice(0, 8)}.md`;
      s.minutes.fileName = minutesName;
      s.minutes.drivePath = copyToDrive(s, path.join(store.sessionDir(s), 'minutes.md'), minutesName);

      // 社内会議は議事録とネクストアクションまで。提案スライドは社外商談のみ
      if (s.type !== 'internal') await makeProposal(s, minutes);
      s.status = 'finished';
      return { ok: true };
    } catch (e) {
      s.status = 'error';
      s.lastError = `議事録・提案の作成に失敗: ${e.message}`;
      console.error(s.lastError);
      return { error: e.message };
    } finally {
      s.busy = null;
      store.save(s, { immediate: true });
    }
  }

  function tick(now = Date.now()) {
    for (const s of store.list()) {
      if (s.status !== 'active' || s.busy) continue;
      if (s.retryAt && now < s.retryAt) continue;
      if (now - (s.lastSummaryAt || s.createdAt) < intervalMs) continue;
      if (!store.segmentsSince(s, s.lastSummaryCutoff || 0).length) continue;
      summarize(s);
    }
  }

  // ---------- HTTP ----------
  const publicDir = path.join(__dirname, '..', 'public');

  function view(s, full) {
    const base = {
      id: s.id, title: s.title, meetingCode: s.meetingCode, type: s.type, mode: s.mode, customer: s.customer, memo: s.memo,
      status: s.status, busy: s.busy, lastError: s.lastError, createdAt: s.createdAt, lastActivityAt: s.lastActivityAt,
      segmentCount: s.segments.length, summaryCount: s.summaries.length,
      nextSummaryAt: s.status === 'active' ? (s.lastSummaryAt || s.createdAt) + intervalMs : null,
    };
    if (!full) return base;
    return {
      ...base,
      summaries: s.summaries,
      minutes: s.minutes && { ...s.minutes, download: `/api/sessions/${encodeURIComponent(s.id)}/minutes.md` },
      proposal: s.proposal && { ...s.proposal, download: `/api/sessions/${encodeURIComponent(s.id)}/proposal.pptx` },
      recent: s.segments.slice(-8),
      folder: store.sessionDir(s),
    };
  }

  function send(res, code, body, type = 'application/json; charset=utf-8') {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 5 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
      });
    });
  }

  async function handle(req, res) {
    // DNS リバインディング対策: localhost 以外のホスト名は拒否
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(host)) return send(res, 403, { error: 'forbidden host' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(publicDir, 'index.html')), 'text/html; charset=utf-8');
    }
    if (!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, intervalMin: cfg.intervalMin });

    // 他のサイトからの書き込み（CSRF）対策: 独自ヘッダー必須（付けるとブラウザは事前確認が必要になり、ここでは許可しない）
    if (req.method !== 'GET' && req.headers['x-meeting-notes'] !== '1') return send(res, 403, { error: 'missing header' });

    if (req.method === 'POST' && p === '/api/segments') {
      const body = await readJson(req);
      if (!/^[a-z]{3,}-[a-z]{3,}-[a-z]{3,}$/.test(String(body.meetingCode || ''))) return send(res, 400, { error: 'bad meetingCode' });
      const { session, changed } = store.upsertSegments(body);
      return send(res, 200, { ok: true, sessionId: session.id, changed, segmentCount: session.segments.length, status: session.status });
    }
    if (req.method === 'GET' && p === '/api/sessions') return send(res, 200, store.list().map((s) => view(s, false)));

    const m = p.match(/^\/api\/sessions\/([^/]+)(?:\/([a-z.]+))?$/);
    const s = m && store.get(decodeURIComponent(m[1]));
    if (!s) return send(res, 404, { error: 'session not found' });
    const action = m[2];

    if (req.method === 'GET' && !action) return send(res, 200, view(s, true));
    if (req.method === 'GET' && action === 'transcript') {
      return send(res, 200, fs.readFileSync(path.join(store.sessionDir(s), 'transcript.md')), 'text/plain; charset=utf-8');
    }
    if (req.method === 'GET' && action === 'minutes.md') {
      const f = path.join(store.sessionDir(s), 'minutes.md');
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not yet' });
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.minutes && s.minutes.fileName ? s.minutes.fileName : 'minutes.md')}`,
      });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'GET' && action === 'proposal.pptx') {
      const f = path.join(store.sessionDir(s), 'proposal.pptx');
      if (!fs.existsSync(f)) return send(res, 404, { error: 'not yet' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.proposal ? s.proposal.fileName : 'proposal.pptx')}`,
      });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'POST' && action === 'settings') {
      const body = await readJson(req);
      if (['online', 'offline'].includes(body.mode)) s.mode = body.mode;
      if (['sales', 'internal'].includes(body.type)) s.type = body.type;
      if (typeof body.customer === 'string') s.customer = body.customer.slice(0, 200);
      if (typeof body.memo === 'string') s.memo = body.memo.slice(0, 2000);
      store.save(s);
      return send(res, 200, view(s, false));
    }
    if (req.method === 'POST' && action === 'summarize') {
      if (s.busy) return send(res, 409, { error: '処理中です' });
      summarize(s, { force: true });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && action === 'finish') {
      if (s.busy) return send(res, 409, { error: '処理中です' });
      if (!s.segments.length) return send(res, 400, { error: '字幕がまだ記録されていません' });
      finish(s);
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && action === 'reopen') {
      s.status = 'active';
      store.save(s);
      return send(res, 200, view(s, false));
    }
    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: e.message }));
  });

  return { server, store, summarize, finish, tick };
}

function checkClaude() {
  const { spawnSync } = require('child_process');
  const { childEnv } = require('./claude');
  const r = spawnSync(config.claudeBin, ['--version'], { env: childEnv(), encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.warn(`⚠ claude コマンドが見つかりません（${config.claudeBin}）。Claude Code をインストールし、\`claude\` でログインしてください。`);
  } else {
    console.log(`Claude Code: ${r.stdout.trim()}`);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('ℹ ANTHROPIC_API_KEY が設定されていますが、API 課金を避けるため claude の実行時には外しています（プランのログインを使用）。');
  }
}

if (require.main === module) {
  const app = createApp();
  checkClaude();
  app.server.listen(config.port, config.host, () => {
    console.log(`会議メモサーバー起動: http://${config.host}:${config.port}/`);
    console.log(`要約の間隔: ${config.intervalMin}分 / 新しい会議の種類: ${config.defaultType === 'internal' ? '社内会議' : '社外商談'} / 保存先: ${config.dataDir}`);
    if (config.driveDir) console.log(`議事録・提案スライドのコピー先: ${config.driveDir}`);
  });
  setInterval(() => app.tick(), 20 * 1000);
  const bye = () => { app.store.flushAll(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

module.exports = { createApp };
