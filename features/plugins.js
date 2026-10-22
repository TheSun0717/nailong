// 插件宿主地基：manifest 校验、安装/卸载/启停、版本比较、状态持久化。
// 第三方插件只允许声明式；第一方签名插件才允许 main.js（由上层决定是否 register）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_PERMISSIONS = new Set([
  'chat', 'kb', 'ai', 'web', 'video', 'teach', 'ui', 'store', 'notify', 'pet', 'settings', 'cron', 'mistakes',
]);
const INTRO_FIELDS = ['what', 'how', 'whatHappens', 'ifFails'];
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

let pluginsDir = '';
let statePath = '';
let state = { enabled: {}, installed: {} };

function init(dir, stateFile) {
  pluginsDir = dir;
  statePath = stateFile;
  fs.mkdirSync(pluginsDir, { recursive: true });
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || typeof state !== 'object') throw new Error('bad state');
    state.enabled = state.enabled || {};
    state.installed = state.installed || {};
  } catch {
    state = { enabled: {}, installed: {} };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function parseVersion(v) {
  const m = VERSION_RE.exec(String(v || ''));
  return m ? m[0].split('.').map(Number) : null;
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

function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest 不是对象'];
  if (!ID_RE.test(String(m.id || ''))) errors.push('id 只能是小写字母/数字/连字符，2-41 位');
  if (!m.name) errors.push('缺少 name');
  if (!VERSION_RE.test(String(m.version || ''))) errors.push('version 必须是 x.y.z');
  if (!VERSION_RE.test(String(m.minAppVersion || ''))) errors.push('minAppVersion 必须是 x.y.z');
  if (!m.description) errors.push('缺少 description');
  if (!m.intro || typeof m.intro !== 'object') {
    errors.push('缺少 intro');
  } else {
    for (const k of INTRO_FIELDS) {
      if (!String(m.intro[k] || '').trim()) errors.push(`intro.${k} 必填`);
    }
  }
  const perms = Array.isArray(m.permissions) ? m.permissions : [];
  for (const p of perms) if (!ALLOWED_PERMISSIONS.has(p)) errors.push(`未知权限：${p}`);
  if (m.dependencies && typeof m.dependencies !== 'object') errors.push('dependencies 必须是对象');
  return errors;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

function readManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  const errors = validateManifest(m);
  if (errors.length) {
    const err = new Error('manifest 校验失败：' + errors.join('；'));
    err.errors = errors;
    throw err;
  }
  return m;
}

function isCompatible(manifest, appVersion) {
  return compareVersions(appVersion, manifest.minAppVersion) >= 0;
}

function list(appVersion) {
  const out = [];
  for (const id of fs.readdirSync(pluginsDir)) {
    if (id.startsWith('.')) continue;
    const dir = path.join(pluginsDir, id);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      const m = readManifest(dir);
      out.push({
        ...m,
        enabled: state.enabled[id] !== false,
        installedAt: state.installed[id] || null,
        compatible: isCompatible(m, appVersion),
      });
    } catch (e) {
      out.push({ id, broken: true, error: e.message });
    }
  }
  return out;
}

function installFromDir(srcDir, { enable = true } = {}) {
  const manifest = readManifest(srcDir);
  const target = path.join(pluginsDir, manifest.id);
  const tmp = path.join(pluginsDir, `.tmp-${manifest.id}-${Date.now()}`);
  const backup = path.join(pluginsDir, `.bak-${manifest.id}`);

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  copyDir(srcDir, tmp);

  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  fs.renameSync(tmp, target);

  state.installed[manifest.id] = Date.now();
  if (enable) state.enabled[manifest.id] = true;
  saveState();
  return manifest;
}

function remove(id) {
  const target = path.join(pluginsDir, String(id));
  if (!target.startsWith(path.resolve(pluginsDir) + path.sep)) throw new Error('非法插件 id');
  fs.rmSync(target, { recursive: true, force: true });
  delete state.installed[id];
  delete state.enabled[id];
  saveState();
  return true;
}

// 更新失败时回到上一版（.bak 目录）
function rollback(id) {
  const target = path.join(pluginsDir, String(id));
  const backup = path.join(pluginsDir, `.bak-${id}`);
  if (!fs.existsSync(backup)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(backup, target);
  state.installed[id] = Date.now();
  saveState();
  return true;
}

function setEnabled(id, enabled) {
  if (!state.installed[id]) throw new Error('插件未安装：' + id);
  state.enabled[id] = !!enabled;
  saveState();
  return true;
}

function enabledIds() {
  return Object.keys(state.installed).filter((id) => state.enabled[id] !== false);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// 把随包分发的内置插件复制到用户插件目录（只装一次，之后由用户启停/更新）
function ensureBundled(bundledDir) {
  if (!fs.existsSync(bundledDir)) return [];
  const added = [];
  for (const id of fs.readdirSync(bundledDir)) {
    const src = path.join(bundledDir, id);
    try {
      if (!fs.statSync(src).isDirectory()) continue;
      const manifest = readManifest(src);
      const current = list().find((d) => d.id === manifest.id);
      if (current && !current.broken && compareVersions(current.version, manifest.version) >= 0) continue;
      installFromDir(src, { enable: true });
      added.push(manifest.id);
    } catch (e) {
      console.warn('[plugins] 内置插件跳过', id, e.message);
    }
  }
  return added;
}

module.exports = {
  init, list, installFromDir, remove, setEnabled, enabledIds, rollback,
  validateManifest, isCompatible, compareVersions, sha256, ensureBundled,
  ALLOWED_PERMISSIONS, INTRO_FIELDS,
};
