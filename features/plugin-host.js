// 插件宿主：加载第一方插件、执行 register(host)，提供白名单能力总线与命令注册表。
const fs = require('fs');
const path = require('path');
const plugins = require('./plugins');

let ctx = null;
const registry = new Map(); // name -> { pluginId, pluginName, description, handler }
const loaded = new Map(); // id -> { manifest, dir }
const timers = [];
const progressSenders = new Map();

const COMMAND_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

function unregister(pluginId) {
  for (const [name, c] of [...registry.entries()]) {
    if (c.pluginId === pluginId) registry.delete(name);
  }
  loaded.delete(pluginId);
}

function init(options) {
  ctx = options;
  registry.clear();
  loaded.clear();
  for (const t of timers) clearInterval(t);
  timers.length = 0;

  for (const p of plugins.list(ctx.appVersion)) {
    if (!p.enabled || !p.compatible || p.broken) continue;
    try {
      // 声明式命令：任何插件都能用，不执行代码
      registerDeclarative(p);
      // 第一方插件才允许执行 main.js
      if (p.firstParty && p.entry && p.entry.main) load(p);
    } catch (e) {
      console.warn(`[plugin-host] 加载 ${p.id} 失败：`, e.message);
      unregister(p.id);
      // 自动回滚到上一版；回滚后只重试一次
      if (plugins.rollback(p.id)) {
        try {
          const restored = plugins.list(ctx.appVersion).find((x) => x.id === p.id);
          if (restored && !restored.broken) {
            registerDeclarative(restored);
            if (restored.firstParty && restored.entry && restored.entry.main) load(restored);
            console.warn(`[plugin-host] 已回滚 ${p.id} 到 ${restored.version}`);
          }
        } catch (e2) {
          console.warn(`[plugin-host] ${p.id} 回滚后仍失败：`, e2.message);
        }
      }
    }
  }
}

async function runDeclarative(manifest, cmd, args) {
  const perms = new Set(manifest.permissions || []);
  const a = cmd.action || {};
  if (a.type === 'web.search') {
    if (!perms.has('web')) throw new Error(`插件 ${manifest.id} 未声明权限：web`);
    const q = a.queryFrom === 'literal' ? String(a.query || '') : String(args || '').trim();
    if (!q) throw new Error('请在命令后面输入关键词');
    const items = await ctx.caps.webSearch(a.platform || 'bilibili', q);
    const list = (items || []).map((it) => ({
      title: it.title,
      subtitle: it.subtitle || `${it.up || ''} · 播放 ${it.play || 0}`,
      action: it.url ? { type: 'open', url: it.url } : undefined,
    }));
    return {
      text: `找到 ${list.length} 条（${q}）`,
      panel: { template: 'list', data: { title: `${a.platform || 'B站'} 搜索：${q}`, items: list } },
    };
  }
  if (a.type === 'ai.ask') {
    if (!perms.has('ai')) throw new Error(`插件 ${manifest.id} 未声明权限：ai`);
    const prompt = String(a.prompt || '{{args}}').replace(/\{\{args\}\}/g, String(args || ''));
    const r = await ctx.caps.aiAsk(prompt);
    return { text: (r && r.text) || '' };
  }
  if (a.type === 'notify') {
    if (!perms.has('notify')) throw new Error(`插件 ${manifest.id} 未声明权限：notify`);
    ctx.caps.notify(String(a.text || args || ''));
    return { text: '已发送通知' };
  }
  throw new Error('不支持的动作类型：' + a.type);
}

function registerDeclarative(manifest) {
  for (const c of Array.isArray(manifest.commands) ? manifest.commands : []) {
    if (!c || !c.name) continue;
    const name = String(c.name).toLowerCase();
    if (!COMMAND_RE.test(name)) throw new Error('非法命令名：' + name);
    if (registry.has(name)) throw new Error('命令已存在：' + name);
    registry.set(name, {
      pluginId: manifest.id,
      pluginName: manifest.name,
      description: c.description || '',
      triggers: Array.isArray(c.triggers) ? c.triggers : [],
      handler: (args) => runDeclarative(manifest, c, args),
    });
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
  const progress = (a, b) => {
    let pct = a, msg = b;
    if (a && typeof a === 'object') { pct = a.pct; msg = a.msg; }
    const fn = progressSenders.get(manifest.id);
    if (fn) fn({ pct: Math.max(0, Math.min(100, Number(pct) || 0)), msg: String(msg || '') });
  };

  const host = {
    progress,
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
      async list() { need('kb'); return ctx.caps.kbList(); },
      async profile() { need('kb'); return ctx.caps.kbProfile(); },
    },
    ai: {
      async ask(prompt) { need('ai'); return ctx.caps.aiAsk(String(prompt ?? '')); },
    },
    web: {
      open(url) { need('web'); return ctx.caps.openExternal(String(url ?? '')); },
      async search(platform, query) { need('web'); return ctx.caps.webSearch(String(platform), String(query)); },
    },
    video: {
      async make(topic) { need('video'); return ctx.caps.videoMake(String(topic ?? ''), progress); },
    },
    teach: {
      async explain(topic) { need('teach'); return ctx.caps.teachExplain(String(topic ?? ''), progress); },
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

function matchIntent(question) {
  const text = String(question || '').toLowerCase();
  if (!text) return [];
  const out = [];
  for (const [name, c] of registry.entries()) {
    const triggers = c.triggers || [];
    if (triggers.some((t) => text.includes(String(t).toLowerCase()))) {
      out.push({ name, pluginId: c.pluginId, pluginName: c.pluginName });
    }
  }
  return out;
}

function commands() {
  return [...registry.entries()].map(([name, c]) => ({
    name,
    pluginId: c.pluginId,
    pluginName: c.pluginName,
    description: c.description,
  }));
}

async function runCommand(name, args, onProgress) {
  const cmd = registry.get(String(name || '').toLowerCase());
  if (!cmd) return { ok: false, error: `没有找到命令 /${name}` };
  if (typeof onProgress === 'function') progressSenders.set(cmd.pluginId, onProgress);
  try {
    const raw = await cmd.handler(args);
    if (typeof raw === 'string') return { ok: true, pluginId: cmd.pluginId, result: { text: raw } };
    if (raw && typeof raw === 'object') return { ok: true, pluginId: cmd.pluginId, result: raw };
    return { ok: true, pluginId: cmd.pluginId, result: {} };
  } catch (e) {
    return { ok: false, error: e.message || String(e), pluginId: cmd.pluginId };
  } finally {
    if (typeof onProgress === 'function') progressSenders.delete(cmd.pluginId);
  }
}

function status() {
  return {
    loaded: [...loaded.values()].map(({ manifest }) => ({ id: manifest.id, name: manifest.name, version: manifest.version })),
    commands: commands(),
  };
}

module.exports = { init, commands, runCommand, matchIntent, status };
