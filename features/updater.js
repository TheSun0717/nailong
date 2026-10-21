// 主程序/插件更新：读取远程 updates.json，下载并校验 SHA-256。
// 安装交给 NSIS 安装包（静默 /S），保留上一版用于回滚。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 主进程里优先用 Electron 的 net.fetch（走系统代理）；纯 Node 测试时回退到全局 fetch
let netFetch = null;
try {
  const { net } = require('electron');
  if (net && typeof net.fetch === 'function') netFetch = net.fetch.bind(net);
} catch {}
const doFetch = (url, opts) => (netFetch ? netFetch(url, opts) : fetch(url, opts));

const SOURCES = [
  'https://raw.githubusercontent.com/TheSun0717/nailong/main/updates.json',
  'https://cdn.jsdelivr.net/gh/TheSun0717/nailong@main/updates.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/TheSun0717/nailong/main/updates.json',
];

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? m.slice(1, 4).map(Number) : null;
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

async function fetchJson(urls, timeout = 8000) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(timeout), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('更新源不可达：' + (lastErr ? lastErr.message : 'unknown'));
}

const API_SOURCE = 'https://api.github.com/repos/TheSun0717/nailong/contents/updates.json?ref=main';

// GitHub raw 的 CDN 缓存可能滞后数分钟，优先走 Contents API（内容实时），失败再回退 raw
async function fetchManifest() {
  try {
    const res = await doFetch(API_SOURCE, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (res.ok) {
      const j = await res.json();
      if (j && j.content) {
        return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      }
    }
  } catch {}
  return fetchJson(SOURCES);
}

async function check(currentVersion) {
  const data = await fetchManifest();
  const app = data && data.app;
  if (!app || !app.version) return { ok: false, error: '更新源格式不正确' };
  return {
    ok: true,
    current: currentVersion,
    latest: app.version,
    hasUpdate: compareVersions(app.version, currentVersion) > 0,
    app,
    plugins: Array.isArray(data.plugins) ? data.plugins : [],
  };
}

async function downloadOne(url, dest, expectedSha, onProgress = () => {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await doFetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);

  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const hash = crypto.createHash('sha256');
  const reader = res.body.getReader();
  let received = 0;
  let lastTick = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    received += buf.length;
    hash.update(buf);
    if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
    const now = Date.now();
    if (now - lastTick > 200) { lastTick = now; onProgress(received, total); }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  const sha = hash.digest('hex');
  if (expectedSha && sha.toLowerCase() !== String(expectedSha).toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error('安装包校验失败（SHA-256 不一致）');
  }
  onProgress(received, total || received);
  return { file: dest, sha, size: received };
}

async function download(urls, dest, expectedSha, onProgress = () => {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr = null;
  for (const url of list) {
    if (!url) continue;
    try { return await downloadOne(url, dest, expectedSha, onProgress); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('没有可用的下载地址');
}

module.exports = { check, download, compareVersions, fetchManifest, SOURCES };
