// 手机端（Capacitor）适配层：桌面版由 preload 注入 window.nailong，这里只在缺失时补齐。
(function () {
  if (window.nailong) return;

  const CFG_KEY = 'nailong.config';
  const CONV_KEY = 'nailong.conv';
  const DEFAULT_CFG = {
    apiKey: '',
    model: 'deepseek-flash',
    verifyModel: '',
    baseUrl: 'https://api.deepseek.com',
    openAtLogin: false,
    hasSeenHint: true,
    userAvatar: false,
    petPosition: null,
    petScale: 1,
    petCanvas: 480,
    petBubble: true,
    profile: { level: '', region: '', school: '', major: '', grade: '' },
  };

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  let config = { ...DEFAULT_CFG, ...read(CFG_KEY, {}) };

  // 手机端内置的声明式插件（网页搜索通过系统浏览器完成）
  const MOBILE_PLUGINS = [{
    id: 'research-kit',
    name: '资料搜索',
    version: '1.1.0',
    description: '用系统浏览器搜索 B 站 / 小红书。',
    intro: {
      what: '它让奶龙帮你打开 B 站或小红书的搜索结果。',
      how: '输入 /bili 关键词 或 /xhs 关键词。',
      whatHappens: '会打开系统浏览器显示搜索结果。',
      ifFails: '检查浏览器是否可用；小红书需要先登录。',
    },
    permissions: ['chat', 'web'],
    capabilities: [],
    dependencies: {},
    commands: [
      { name: 'bili', description: '搜索 B 站', platform: 'bilibili', triggers: ['b站', 'bilibili', '公开课'] },
      { name: 'xhs', description: '搜索小红书', platform: 'xiaohongshu', triggers: ['小红书', 'xhs'] },
    ],
  }];

  const ASSETS = {
    'avatar/nailong-face.webp': 'assets/avatar/nailong-face.webp',
    'pet/pose-wink.webp': 'assets/pet/pose-wink.webp',
    'pet/pose-sleep.webp': 'assets/pet/pose-sleep.webp',
    'pet/pose-stand.webp': 'assets/pet/pose-stand.webp',
  };

  const FIXED = [
    { re: /你是谁|你叫什么|自我介绍|介绍一下你|你是什么/, answer: '我是奶龙' },
    { re: /帅/, answer: '当然是彭唯哲！' },
    { re: /最美|最漂亮|漂亮|好看/, answer: '我猜是蒋雨蒙吧' },
  ];
  const STUDY_RE = /怎么学|如何学|学习路径|学习路线|复习计划|复习|备考|期末|期中|考研|保研|先修|这门课|课程|教材|参考书|刷题|入门|知识点|考试|作业|讲义|试卷|学习方法/;

  function matchFixed(q) {
    const s = String(q || '').trim();
    for (const r of FIXED) if (r.re.test(s)) return r.answer;
    return null;
  }

  function profileText(p = {}) {
    const parts = [];
    if (p.level) parts.push(`学段：${p.level}`);
    if (p.region) parts.push(`地区：${p.region}`);
    if (p.school) parts.push(`学校：${p.school}`);
    if (p.major) parts.push(`专业：${p.major}`);
    if (p.grade) parts.push(`年级：${p.grade}`);
    return parts.length ? parts.join('；') : '（用户还没填写画像）';
  }

  function systemPrompt(q) {
    const base = `你是「奶龙」，动画《奶龙》里那只圆滚滚、黄澄澄的小奶龙，现在陪在主人手机里。用中文、口语化、软萌，但内容要认真准确。不要承认自己是程序。`;
    if (!STUDY_RE.test(String(q || ''))) return base;
    return `你是「奶龙」的学习规划模式。
用户画像：${profileText(config.profile)}
回答要求：先用一句话说清难点和学完会什么；给出前置知识；给出分阶段计划（每周做什么、每天多久）；给出资料类型（不要编造某校内部资料）；给出自测检验方式；用 Markdown，结构清楚，中文，内容优先。`;
  }

  const listeners = [];
  const streamSubs = new Map();

  async function streamOnce(id, q) {
    const send = (p) => { if (streamSubs.has(id)) streamSubs.get(id)({ id, ...p }); };
    const fixed = matchFixed(q);
    if (fixed) { send({ delta: fixed }); send({ done: true }); streamSubs.delete(id); return; }
    if (!config.apiKey) {
      send({ delta: '我还没有连上大脑哦～先在右上角设置里填一下 DeepSeek Key 吧！' });
      send({ done: true }); streamSubs.delete(id); return;
    }
    if (STUDY_RE.test(String(q || ''))) send({ meta: { mode: 'study', refs: [] } });
    try {
      const base = String(config.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
      const res = await fetch(base.endsWith('/chat/completions') ? base : base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
        body: JSON.stringify({
          model: config.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt(q) },
            { role: 'user', content: String(q || '').trim() },
          ],
          temperature: 1.0,
          stream: true,
        }),
      });
      if (!res.ok) throw new Error('DeepSeek ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { send({ done: true }); streamSubs.delete(id); return; }
          try {
            const j = JSON.parse(payload);
            const d = j.choices?.[0]?.delta?.content;
            if (d) send({ delta: d });
          } catch {}
        }
      }
      send({ done: true });
    } catch (e) {
      send({ error: e.message || String(e) });
    } finally {
      streamSubs.delete(id);
    }
  }

  function pickImage() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(f);
      };
      input.click();
    });
  }

  window.nailong = {
    getAsset: async (name) => ASSETS[name] || 'assets/' + name,
    getConfig: async () => config,
    setConfig: async (patch) => { config = { ...config, ...patch }; write(CFG_KEY, config); return config; },

    ask: async (q) => {
      const fixed = matchFixed(q);
      if (fixed) return { text: fixed, local: true };
      if (!config.apiKey) return { text: '先在设置里填一下 DeepSeek Key 吧～', local: true };
      const base = String(config.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
      const res = await fetch(base.endsWith('/chat/completions') ? base : base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
        body: JSON.stringify({
          model: config.model || 'deepseek-chat',
          messages: [{ role: 'system', content: systemPrompt(q) }, { role: 'user', content: q }],
        }),
      });
      const data = await res.json();
      return { text: data.choices?.[0]?.message?.content || '吼吼，我脑子卡住啦', local: false };
    },
    askStream: (id, q) => {
      streamSubs.set(id, (p) => listeners.forEach((cb) => cb(p)));
      streamOnce(id, q);
    },
    onStream: (cb) => listeners.push(cb),

    loadConversation: async () => read(CONV_KEY, []),
    saveConversation: async (messages) => { write(CONV_KEY, messages); return true; },
    clearConversation: async () => { localStorage.removeItem(CONV_KEY); return true; },
    loadTabs: async () => { try { return JSON.parse(localStorage.getItem('nailong.tabs')); } catch { return null; } },
    saveTabs: async (data) => { try { localStorage.setItem('nailong.tabs', JSON.stringify(data)); } catch {} return true; },
    clearTabs: async () => { localStorage.removeItem('nailong.tabs'); return true; },

    pickAvatar: async () => {
      const url = await pickImage();
      if (url) {
        try { localStorage.setItem('nailong.avatar', url); } catch {}
        config.userAvatar = true;
        write(CFG_KEY, config);
      }
      return url;
    },
    getAvatarUrl: async () => {
      if (!config.userAvatar) return null;
      try { return localStorage.getItem('nailong.avatar'); } catch { return null; }
    },

    pickFile: async () => [],
    listFiles: async () => [],
    openFile: async () => null,
    deleteFile: async () => null,
    renameFile: async () => null,
    ocrFile: async () => ({ error: '手机版暂不支持图片识别' }),

    saveNote: async (text) => {
      try { await navigator.clipboard.writeText(String(text || '')); return '剪贴板'; } catch { return null; }
    },
    importStudyFiles: async () => [{ name: '资料导入', error: '手机版暂不支持，请在桌面版导入' }],
    listKnowledge: async () => [],
    removeKnowledge: async () => false,
    searchBilibili: async () => ({ error: '手机版暂不支持联网补充资料' }),
    listPlugins: async () => MOBILE_PLUGINS.map((p) => ({ ...p, enabled: true, compatible: true })),
    pluginCommands: async () => MOBILE_PLUGINS.flatMap((p) => (p.commands || []).map((c) => ({
      name: c.name, pluginId: p.id, pluginName: p.name, description: c.description || '',
    }))),
    pluginStatus: async () => ({ loaded: MOBILE_PLUGINS.map((p) => ({ id: p.id, name: p.name, version: p.version })), commands: [] }),
    runPluginCommand: async (name, args) => {
      const q = String(args || '').trim();
      const plugin = MOBILE_PLUGINS[0];
      const cmd = (plugin.commands || []).find((c) => c.name === name);
      if (!cmd) return { ok: false, error: '手机版没有这个命令' };
      if (!q) return { ok: false, error: '请在命令后面输入关键词' };
      const url = cmd.platform === 'xiaohongshu'
        ? 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(q)
        : 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(q);
      try {
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click();
      } catch {}
      return { ok: true, pluginId: plugin.id, result: { text: `已在浏览器打开${cmd.platform === 'xiaohongshu' ? '小红书' : 'B 站'}搜索：${q}
${url}` } };
    },
    setPluginEnabled: async () => true,
    removePlugin: async () => false,
    storeList: async () => ({ ok: true, items: MOBILE_PLUGINS.map((p) => ({ ...p, compatible: true })) }),
    storeInstall: async () => ({ ok: true }),
    onPluginProgress: () => {},
    onPetSay: () => {},
    onPluginNotify: () => {},
    openExternal: (url) => { try { window.open(String(url), '_blank'); return true; } catch { return false; } },

    generateExplainer: async () => ({ ok: false, error: '手机版暂不支持生成讲解页，请在桌面版使用' }),
    openExplainer: async () => false,
    generateVideo: async () => ({ ok: false, error: '手机版暂不支持生成视频，请在桌面版使用' }),
    onVideoProgress: () => {},
    openVideo: async () => false,

    applyPetSettings: async () => false,
    petHover: () => {}, movePet: () => {}, moveEnd: () => {}, singleClick: () => {}, doubleClick: () => {},
    onFullscreen: () => {}, closeFullscreen: () => {}, closeChat: () => {},
  };
})();
