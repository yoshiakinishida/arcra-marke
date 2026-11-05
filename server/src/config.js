'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// リポジトリ直下の .env を読み込む（依存ライブラリなしの簡易版）
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const expandHome = (p) => (p && p.startsWith('~') ? path.join(require('os').homedir(), p.slice(1)) : p);

module.exports = {
  root: ROOT,
  host: '127.0.0.1',
  port: Number(process.env.PORT) || 3939,
  // 何分ごとに要約するか
  intervalMin: Number(process.env.SUMMARY_INTERVAL_MIN) || 10,
  // claude -p に渡すモデル（エイリアス: haiku / sonnet / opus）
  summaryModel: process.env.SUMMARY_MODEL || 'sonnet',
  minutesModel: process.env.MINUTES_MODEL || 'sonnet',
  proposalModel: process.env.PROPOSAL_MODEL || 'opus',
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  claudeTimeoutMs: (Number(process.env.CLAUDE_TIMEOUT_SEC) || 600) * 1000,
  dataDir: expandHome(process.env.DATA_DIR) || path.join(ROOT, 'data'),
  materialsDir: expandHome(process.env.MATERIALS_DIR) || path.join(ROOT, 'materials'),
  // Google ドライブ for デスクトップの同期フォルダ（設定すると提案スライドをここにもコピー）
  driveDir: expandHome(process.env.DRIVE_DIR) || '',
  myCompany: process.env.MY_COMPANY || '',
  // 最後の字幕からこの時間が経つと、同じ会議コードでも別の商談として扱う
  sessionGapMin: Number(process.env.SESSION_GAP_MIN) || 180,
};
