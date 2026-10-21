// 插件宿主：加载第一方插件、执行 register(host)，提供白名单能力总线与命令注册表。
const fs = require('fs');
const path = require('path');
const plugins = require('./plugins');

let ctx = null;
const registry = new Map(); // name -> { pluginId, pluginName, description, handler }
const loaded = new Map(); // id -> { manifest, dir }
const timers = [];

const COMMAND_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

function init(options) {
  ctx = options;
  registry.clear();
  loaded.clear();
  for (const t of timers) clearInterval(t);
  timers.length = 0;

  for (const p of plugins.list(ctx.appVersion)) {
    if (!p.enabled || !p.compatible || p.broken) continue;
    if (!p.firstParty) continue; // 第三方插件只允许声明式，不执行代码
    if (!p.entry || !p.entry.main) continue;
    try {
      load(p);
    } catch (e) {
      console.warn(`[plugin-host] 加载 ${p.id} 失败：`, e.message);
    }
  }
}

function load(manifest) {
  if (loaded.has(manifest.id)) return;
  const dir = path.join(ctx.pluginsDir, manifest.id);
  const entry = path.join(dir, manifest.entry.main);
  if (!entry.startsWith(path.resolve(dir) + path.sep)) throw new Error('非法入口路径');
  const mod = require(entry);
  if (typeof mod.register !== 'function') throw new Error('插件没有导出 register(host)');
  const host = createHost(manifest, dir);
  mod.register(host);
  loaded.set(manifest.id, { manifest, dir });
}

function readSettings(id) {
  const file = path.join(ctx.userDataDir, 'plugin-data', `${id}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function writeSettings(id, data) {
  const file = path.join(ctx.userDataDir, 'plugin-data', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function createHost(manifest, dir) {
  const perms = new Set(manifest.permissions || []);
  const need = (p) => {
    if (!perms.has(p)) throw new Error(`插件 ${manifest.id} 未声明权限：${p}`);
  };
  const settings = readSettings(manifest.id);

  const host = {
    id: manifest.id,
    version: manifest.version,
    chat: {
      command(name, handler, description = '') {
        need('chat');
        const cmd = String(name || '').toLowerCase();
        if (!COMMAND_RE.test(cmd)) throw new Error('命令名只能是小写字母/数字/连字符');
        if (registry.has(cmd)) throw new Error(`命令已存在：${cmd}`);
        if (typeof handler !== 'function') throw new Error('命令处理函数无效');
        registry.set(cmd, { pluginId: manifest.id, pluginName: manifest.name, description, handler });
      },
    },
    pet: {
      say(text) { need('pet'); ctx.caps.petSay(String(text ?? '')); },
    },
    notify(text) {
      need('notify');
      ctx.caps.notify(String(text ?? ''));
    },
    kb: {
      async search(query) { need('kb'); return ctx.caps.kbSearch(String(query ?? '')); },
      async add(text, meta) { need('kb'); return ctx.caps.kbAdd(String(text ?? ''), meta || {}); },
    },
    ai: {
      async ask(prompt) { need('ai'); return ctx.caps.aiAsk(String(prompt ?? '')); },
    },
    web: {
      open(url) { need('web'); return ctx.caps.openExternal(String(url ?? '')); },
      async search(platform, query) { need('web'); return ctx.caps.webSearch(String(platform), String(query)); },
    },
    video: {
      async make(topic) { need('video'); return ctx.caps.videoMake(String(topic ?? '')); },
    },
    store: {
      async install(id) { need('store'); return ctx.caps.storeInstall(String(id)); },
    },
    ui: {
      panel(template, data) { need('ui'); return { template, data }; },
    },
    settings: {
      get(key) { return settings[key]; },
      set(key, value) { settings[key] = value; writeSettings(manifest.id, settings); },
    },
    cron: {
      schedule(expr, fn) {
        need('cron');
        const m = /^\*\/(\d+) \* \* \* \*$/.exec(String(expr || '').trim());
        const minutes = m ? Math.max(10, Number(m[1])) : 10;
        const timer = setInterval(() => { try { fn(); } catch (e) { console.warn('[plugin-host] cron 失败', e.message); } }, minutes * 60000);
        timers.push(timer);
      },
    },
  };
  return host;
}

function commands() {
  return [...registry.entries()].map(([name, c]) => ({
    name,
    pluginId: c.pluginId,
    pluginName: c.pluginName,
    description: c.description,
  }));
}

async function runCommand(name, args) {
  const cmd = registry.get(String(name || '').toLowerCase());
  if (!cmd) return { ok: false, error: `没有找到命令 /${name}` };
  try {
    const raw = await cmd.handler(args);
    if (typeof raw === 'string') return { ok: true, pluginId: cmd.pluginId, result: { text: raw } };
    if (raw && typeof raw === 'object') return { ok: true, pluginId: cmd.pluginId, result: raw };
    return { ok: true, pluginId: cmd.pluginId, result: {} };
  } catch (e) {
    return { ok: false, error: e.message || String(e), pluginId: cmd.pluginId };
  }
}

function status() {
  return {
    loaded: [...loaded.values()].map(({ manifest }) => ({ id: manifest.id, name: manifest.name, version: manifest.version })),
    commands: commands(),
  };
}

module.exports = { init, commands, runCommand, status };
