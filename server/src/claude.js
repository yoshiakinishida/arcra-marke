'use strict';
const { spawn } = require('child_process');
const config = require('./config');

// Claude Code を非対話モードで呼び出す。
// ANTHROPIC_API_KEY が環境変数にあると API 課金になるため、子プロセスからは必ず外す。
function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

let queue = Promise.resolve();

// 同時に複数実行するとプランの利用枠を一気に消費するので、1件ずつ直列に実行する
function runClaude({ prompt, model }) {
  const job = queue.then(() => runOnce({ prompt, model }));
  queue = job.catch(() => {});
  return job;
}

function runOnce({ prompt, model }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence'];
    if (model) args.push('--model', model);
    const child = spawn(config.claudeBin, args, {
      env: childEnv(),
      cwd: config.dataDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude がタイムアウトしました（${config.claudeTimeoutMs / 1000}秒）`));
    }, config.claudeTimeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`claude を起動できません（${config.claudeBin}）: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`claude が失敗しました (exit ${code}): ${(err || out).trim().slice(0, 500)}`));
    });
    child.stdin.end(prompt);
  });
}

module.exports = { runClaude, childEnv };
