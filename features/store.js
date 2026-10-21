// 插件商店：读取 updates.json 的 plugins 列表，下载 zip、校验 SHA-256、安全解压并安装。
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const updater = require('./updater');
const plugins = require('./plugins');

async function list(appVersion) {
  const data = await updater.fetchManifest();
  const items = Array.isArray(data.plugins) ? data.plugins : [];
  return items.map((p) => ({
    ...p,
    compatible: updater.compareVersions(appVersion, p.minAppVersion || '0.0.0') >= 0,
  }));
}

async function install(entry, { appVersion, tmpRoot }) {
  if (!entry || !entry.id || !entry.url) throw new Error('商店条目无效');
  if (updater.compareVersions(appVersion, entry.minAppVersion || '0.0.0') < 0) {
    throw new Error(`需要先更新奶龙到 ${entry.minAppVersion}`);
  }

  fs.mkdirSync(tmpRoot, { recursive: true });
  const zipPath = path.join(tmpRoot, `${entry.id}-${entry.version || 'x'}.zip`);
  await updater.download([entry.url].concat(entry.mirrors || []), zipPath, entry.sha256);

  const extractDir = path.join(tmpRoot, `extract-${entry.id}-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  for (const e of zip.getEntries()) {
    const name = String(e.entryName || '').replace(/\\/g, '/');
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error('压缩包包含非法路径');
    }
  }
  zip.extractAllTo(extractDir, true);

  let src = extractDir;
  if (!fs.existsSync(path.join(src, 'manifest.json'))) {
    const dirs = fs.readdirSync(extractDir)
      .map((n) => path.join(extractDir, n))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
    if (dirs.length === 1 && fs.existsSync(path.join(dirs[0], 'manifest.json'))) src = dirs[0];
  }
  if (!fs.existsSync(path.join(src, 'manifest.json'))) throw new Error('压缩包里没有 manifest.json');

  const installed = plugins.installFromDir(src, { enable: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  return installed;
}

module.exports = { list, install };
