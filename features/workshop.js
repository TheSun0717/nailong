// 能力工坊：把一句描述变成声明式插件（只填 JSON，不执行代码），五道闸后安装。
const fs = require('fs');
const path = require('path');
const ai = require('../ai');
const plugins = require('./plugins');

const ACTIONS = {
  'web.search': { perm: 'web', platforms: ['bilibili'] },
  'ai.ask': { perm: 'ai' },
  notify: { perm: 'notify' },
};
const COMMAND_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function systemPrompt() {
  return `你是奶龙的插件设计师。根据用户描述，输出一个「声明式插件」JSON，只输出 JSON，不要 Markdown 围栏。

允许的插件能力（action.type）只有三种：
1. {"type":"web.search","platform":"bilibili","queryFrom":"args"} —— 搜 B 站，返回视频列表面板（需要 web + ui 权限）
2. {"type":"ai.ask","prompt":"提示词，用 {{args}} 插入用户输入"} —— 调大模型回答（需要 ai 权限）
3. {"type":"notify","text":"通知内容"} —— 发一条通知（需要 notify 权限）

JSON 结构：
{
  "id": "小写字母和连字符",
  "name": "插件名",
  "description": "一句话说明",
  "intro": {
    "what": "它是干什么的（小学生能懂）",
    "how": "点哪里",
    "whatHappens": "会发生什么",
    "ifFails": "失败了怎么办"
  },
  "permissions": ["chat", "web", "ui"],
  "commands": [
    {"name": "命令名", "description": "命令说明", "action": {"type": "web.search", "platform": "bilibili", "queryFrom": "args"}}
  ]
}

硬性要求：
- 1 到 2 个命令；命令名小写字母/数字/连字符。
- permissions 必须包含 "chat"，并按 action 补上 "web"/"ai"/"notify"；web.search 还要加 "ui"。
- id 不能是 hello-plugin、bili-search。
- 不要输出 main.js、不要输出 HTML、不要输出任何解释。
- intro 四个字段必须都写，口语化，小学生能看懂。

只输出 JSON。`;
}

function extractJson(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// 第 1-3 道闸：结构、权限、动作白名单
function validateSpec(spec, appVersion) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return ['不是 JSON 对象'];
  if (!ID_RE.test(String(spec.id || ''))) errors.push('id 只能是小写字母/数字/连字符');
  if (['hello-plugin', 'bili-search'].includes(spec.id)) errors.push('id 与内置插件冲突');
  if (!spec.name) errors.push('缺少 name');
  if (!spec.description) errors.push('缺少 description');
  if (!spec.intro || typeof spec.intro !== 'object') {
    errors.push('缺少 intro');
  } else {
    for (const k of ['what', 'how', 'whatHappens', 'ifFails']) {
      if (!String(spec.intro[k] || '').trim()) errors.push(`intro.${k} 必填`);
    }
  }
  const perms = new Set(Array.isArray(spec.permissions) ? spec.permissions : []);
  if (!perms.has('chat')) errors.push('permissions 必须包含 chat');
  const cmds = Array.isArray(spec.commands) ? spec.commands : [];
  if (!cmds.length) errors.push('至少需要一个命令');
  if (cmds.length > 2) errors.push('最多两个命令');
  for (const c of cmds) {
    if (!c || !COMMAND_RE.test(String(c.name || ''))) errors.push('命令名不合法：' + (c && c.name));
    const a = (c && c.action) || {};
    const rule = ACTIONS[a.type];
    if (!rule) { errors.push('不支持的动作类型：' + a.type); continue; }
    if (!perms.has(rule.perm)) errors.push(`命令 ${c.name} 需要 ${rule.perm} 权限`);
    if (a.type === 'web.search') {
      if (!rule.platforms.includes(a.platform)) errors.push('web.search 只支持 bilibili');
      if (!perms.has('ui')) errors.push('web.search 需要 ui 权限');
      if (a.queryFrom !== 'args') errors.push('web.search 的 queryFrom 必须是 args');
    }
    if (a.type === 'ai.ask' && !String(a.prompt || '').includes('{{args}}')) {
      errors.push('ai.ask 的 prompt 必须包含 {{args}}');
    }
    if (a.type === 'notify' && !String(a.text || '').trim()) errors.push('notify 需要 text');
  }
  if (errors.length) return errors;
  // 统一补齐宿主需要的字段
  spec.version = '1.0.0';
  spec.minAppVersion = appVersion;
  spec.firstParty = false;
  spec.dependencies = spec.dependencies || {};
  return [];
}

function clone(spec) {
  return JSON.parse(JSON.stringify(spec));
}

// 第 4 道闸：用样例数据 mock 执行每个动作，验证输出形状
function mockRun(spec) {
  const results = [];
  for (const c of spec.commands || []) {
    const a = c.action || {};
    if (a.type === 'web.search') {
      results.push({
        command: c.name,
        ok: true,
        result: {
          text: '试运行：会返回 B 站视频列表',
          panel: {
            template: 'list',
            data: {
              title: '试运行 · B站搜索：示例',
              items: [
                { title: '示例视频 A', subtitle: '示例 UP · 播放 100', action: { type: 'open', url: 'https://www.bilibili.com' } },
                { title: '示例视频 B', subtitle: '示例 UP · 播放 200', action: { type: 'open', url: 'https://www.bilibili.com' } },
              ],
            },
          },
        },
      });
    } else if (a.type === 'ai.ask') {
      results.push({ command: c.name, ok: true, result: { text: '试运行：这里会显示模型的回答。' } });
    } else if (a.type === 'notify') {
      results.push({ command: c.name, ok: true, result: { text: '试运行：会发出一条通知。' } });
    } else {
      results.push({ command: c.name, ok: false, error: '不支持的动作' });
    }
  }
  return results;
}

async function generate(description, config, appVersion) {
  const desc = String(description || '').trim();
  if (desc.length < 4) return { ok: false, errors: ['请多写几个字描述你想要的插件'] };

  let raw = await ai.askDeepSeek(desc, config, systemPrompt(), 0.4);
  let spec = extractJson(raw);
  let errors = spec ? validateSpec(spec, appVersion) : ['模型没有返回 JSON'];

  // 第 5 道闸：失败自动修复，最多 2 次
  for (let attempt = 0; attempt < 2 && errors.length; attempt++) {
    const repairPrompt = `上一次的输出有问题：\n${errors.join('\n')}\n\n上一次输出：\n${raw}\n\n请修正后只输出 JSON。`;
    raw = await ai.askDeepSeek(repairPrompt, config, systemPrompt(), 0.3);
    spec = extractJson(raw);
    errors = spec ? validateSpec(spec, appVersion) : ['模型没有返回 JSON'];
  }
  if (errors.length) return { ok: false, errors, raw: String(raw).slice(0, 1200) };

  const mock = mockRun(spec);
  if (mock.some((m) => !m.ok)) {
    return { ok: false, errors: ['试运行失败：' + mock.filter((m) => !m.ok).map((m) => m.command).join('、')] };
  }
  return { ok: true, spec, mock };
}

function install(spec, { appVersion, tmpRoot }) {
  const errors = validateSpec(spec, appVersion);
  if (errors.length) throw new Error('插件校验失败：' + errors.join('；'));
  const dir = path.join(tmpRoot, `workshop-${spec.id}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(spec, null, 2), 'utf8');
  return plugins.installFromDir(dir, { enable: true });
}

module.exports = { generate, install, mockRun, validateSpec, systemPrompt };
