'use strict';
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
function stamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function hhmm(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTranscript(segments) {
  return segments.map((s) => `[${hhmm(s.firstSeen)}] ${s.speaker || '(不明)'}: ${s.text}`).join('\n');
}

class Store {
  constructor({ dataDir, sessionGapMin, defaultType = 'sales' }) {
    this.defaultType = defaultType;
    this.dir = path.join(dataDir, 'sessions');
    this.gapMs = sessionGapMin * 60 * 1000;
    this.sessions = new Map();
    this.saveTimers = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  load() {
    for (const id of fs.readdirSync(this.dir)) {
      const f = path.join(this.dir, id, 'session.json');
      if (!fs.existsSync(f)) continue;
      try {
        const s = JSON.parse(fs.readFileSync(f, 'utf8'));
        s.busy = null; // 再起動時に実行中フラグは解除
        if (s.status === 'finishing') s.status = 'error';
        if (!s.type) s.type = 'sales';
        this.sessions.set(s.id, s);
      } catch (e) {
        console.warn(`読み込み失敗: ${f}: ${e.message}`);
      }
    }
  }

  sessionDir(s) {
    return path.join(this.dir, s.id);
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  get(id) {
    return this.sessions.get(id);
  }

  findOrCreate({ meetingCode, title, url }, now = Date.now()) {
    const candidates = this.list().filter(
      (s) => s.meetingCode === meetingCode && s.status === 'active' && now - s.lastActivityAt < this.gapMs
    );
    if (candidates.length) return candidates[0];
    // 定例会議などで同じ会議URLを使い回す場合は、前回の設定を引き継ぐ
    const previous = this.list().find((s) => s.meetingCode === meetingCode);
    let id = `${stamp(now)}_${meetingCode}`;
    while (this.sessions.has(id)) id += '_';
    const s = {
      id,
      meetingCode,
      title: title || meetingCode,
      url: url || '',
      type: previous ? previous.type || 'sales' : this.defaultType, // sales（社外商談） | internal（社内会議） | consult（社外打ち合わせ）
      mode: previous ? previous.mode : 'online', // online | offline（対面）
      customer: previous ? previous.customer : '',
      memo: '',
      createdAt: now,
      lastActivityAt: now,
      status: 'active', // active | finishing | finished | error
      segments: [],
      summaries: [],
      lastSummaryCutoff: 0, // ここまでに更新された字幕は要約済み
      lastSummaryAt: null,
      minutes: null,
      proposal: null,
      lastError: null,
      busy: null,
    };
    this.sessions.set(id, s);
    fs.mkdirSync(this.sessionDir(s), { recursive: true });
    this.save(s);
    return s;
  }

  upsertSegments(payload, now = Date.now()) {
    const s = this.findOrCreate(payload, now);
    if (payload.title && s.title === s.meetingCode) s.title = payload.title;
    const byId = new Map(s.segments.map((x) => [x.id, x]));
    let changed = 0;
    for (const seg of payload.segments || []) {
      if (!seg || !seg.id || typeof seg.text !== 'string' || !seg.text.trim()) continue;
      const text = seg.text.trim().slice(0, 20000);
      const speaker = String(seg.speaker || '').slice(0, 100);
      const cur = byId.get(seg.id);
      if (cur) {
        if (cur.text !== text || (speaker && cur.speaker !== speaker)) {
          cur.text = text;
          if (speaker) cur.speaker = speaker;
          cur.lastUpdated = now;
          changed++;
        }
      } else {
        const x = { id: String(seg.id), speaker, text, firstSeen: Number(seg.firstSeen) || now, lastUpdated: now };
        s.segments.push(x);
        byId.set(x.id, x);
        changed++;
      }
    }
    if (changed) {
      s.segments.sort((a, b) => a.firstSeen - b.firstSeen);
      s.lastActivityAt = now;
      this.save(s);
    }
    return { session: s, changed };
  }

  // 前回の要約以降に追加・更新された字幕
  segmentsSince(s, since) {
    return s.segments.filter((x) => x.lastUpdated > since);
  }

  save(s, { immediate = false } = {}) {
    clearTimeout(this.saveTimers.get(s.id));
    const write = () => {
      this.saveTimers.delete(s.id);
      const dir = this.sessionDir(s);
      fs.mkdirSync(dir, { recursive: true });
      const { busy, ...persist } = s;
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(persist, null, 2));
      fs.writeFileSync(path.join(dir, 'transcript.md'), `# 文字起こし: ${s.title}\n\n${formatTranscript(s.segments)}\n`);
    };
    if (immediate) write();
    else this.saveTimers.set(s.id, setTimeout(write, 1000));
  }

  writeFile(s, name, content) {
    const f = path.join(this.sessionDir(s), name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
    return f;
  }

  flushAll() {
    for (const s of this.sessions.values()) if (this.saveTimers.has(s.id)) this.save(s, { immediate: true });
  }
}

module.exports = { Store, formatTranscript, hhmm, stamp };
