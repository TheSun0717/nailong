const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, screen, nativeImage, globalShortcut, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { pathToFileURL } = require('url');
const ai = require('./ai');
const kb = require('./features/kb');
const study = require('./features/study');
const teach = require('./features/teach');
const video = require('./features/video');
const bili = require('./features/bilibili');
const updater = require('./features/updater');
const plugins = require('./features/plugins');
const pluginHost = require('./features/plugin-host');
const store = require('./features/store');
const providers = require('./features/providers');

// 开发环境用独立 profile：避免和已安装版本抢单实例锁，也避免污染正式配置
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'nailong-dev'));

const userDataDir = app.getPath('userData');
const configPath = path.join(userDataDir, 'config.json');
const filesDir = path.join(userDataDir, 'files');
const dataDir = path.join(userDataDir, 'data');
const convPath = path.join(dataDir, 'conversations', 'main.json');
const tabsPath = path.join(dataDir, 'conversations', 'tabs.json');
const explainDir = path.join(dataDir, 'explain');
const videoDir = path.join(dataDir, 'video');
kb.init(path.join(dataDir, 'kb'));
kb.ensureSeeds(path.join(__dirname, 'data', 'seed')).catch(() => {});

const pluginsDir = path.join(dataDir, 'plugins');
const pluginStatePath = path.join(dataDir, 'plugin-state.json');
plugins.init(pluginsDir, pluginStatePath);
plugins.ensureBundled(path.join(__dirname, 'plugins'));

function initPluginHost() {
  pluginHost.init({
    pluginsDir,
    userDataDir: dataDir,
    appVersion: app.getVersion(),
    caps: {
      petSay: (t) => { if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet-say', t); },
      notify: (t) => { if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('plugin-notify', t); },
      kbSearch: async (q) => kb.search(q, { school: config.profile && config.profile.school, level: config.profile && config.profile.level, limit: 6 }),
      kbAdd: async (text, meta) => kb.addText(meta && meta.name, text, meta || {}),
      aiAsk: async (p) => ({ text: await ai.askDeepSeek(p, config) }),
      openExternal: (u) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); },
      webSearch: async (platform, q) => (String(platform).toLowerCase() === 'bilibili' ? bili.search(q) : []),
      videoMake: async (topic) => video.generate(topic, config, videoDir),
      storeInstall: async () => ({ ok: false, error: '商店安装将在下一版开放' }),
    },
  });
}
const avatarPath = path.join(userDataDir, 'avatar.png');
const assetsRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, 'assets');
const ocrScript = app.isPackaged
  ? path.join(process.resourcesPath, 'tools', 'ocr.py')
  : path.join(__dirname, 'tools', 'ocr.py');

const DEFAULT_CONFIG = {
  apiKey: '', // 不预置 Key：每位用户在自己的电脑上填写（公开仓库不能带凭证）
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
  openAtLogin: true,
  hasSeenHint: false,
  userAvatar: false,
  petPosition: null, // 奶龙位置 {x, y}，拖拽后记住
  petScale: 1, // 桌宠缩放 0.5 - 2.0
  petCanvas: 480, // 桌宠窗口画布大小（手动可调，不随缩放变化）
  petBubble: true, // 自动气泡开关
  profile: { level: '', region: '', school: '', major: '', grade: '' },
};

// 允许自动播放音频/视频（生日歌循环需要）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 单实例：已打开就聚焦已有奶龙，不再开第二个
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin) petWin.show();
  });
}

let config = loadConfig();
let petWin = null;
let chatWin = null;
let fullWin = null;
let explainWin = null;
let tray = null;

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig() {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const out = { ...config };
    // API Key 用系统级加密（Windows DPAPI）落盘；不写明文
    if (out.apiKey && safeStorage.isEncryptionAvailable()) {
      out.apiKeyEnc = safeStorage.encryptString(String(out.apiKey)).toString('base64');
      delete out.apiKey;
    }
    fs.writeFileSync(configPath, JSON.stringify(out, null, 2));
  } catch {}
}

// app ready 之后才能用 safeStorage：解密到内存，并把旧的明文 Key 迁移成密文
function unlockSecrets() {
  if (config.apiKeyEnc) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        config.apiKey = safeStorage.decryptString(Buffer.from(config.apiKeyEnc, 'base64'));
      }
    } catch (e) {
      console.warn('[奶龙] API Key 解密失败：', e.message);
    }
    delete config.apiKeyEnc;
  }
  if (config.apiKey && safeStorage.isEncryptionAvailable()) saveConfig();
}
function assetUrl(rel) {
  return pathToFileURL(path.join(assetsRoot, rel)).href;
}

// ---------- 窗口 ----------
function createPet() {
  if (petWin) { petWin.show(); return; }
  const canvas = Math.min(640, Math.max(360, Number(config.petCanvas) || 480));
  petWin = new BrowserWindow({
    width: canvas,
    height: canvas,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.loadFile(path.join(__dirname, 'ui', 'pet.html'));
  petWin.on('closed', () => { petWin = null; });
  petWin.once('ready-to-show', () => positionPet());
}

// 贴任务栏上方（workArea 已排除任务栏，底部即任务栏上沿），默认右下角；拖拽后记住位置
function positionPet() {
  if (!petWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = petWin.getSize();
  let x, y;
  if (config.petPosition) {
    x = config.petPosition.x;
    y = config.petPosition.y;
    // 边界保护：位置在屏幕外就回退到默认位置（防止拖到屏幕外后下次看不到）
    if (x < workArea.x || y < workArea.y || x + w > workArea.x + workArea.width || y + h > workArea.y + workArea.height) {
      x = workArea.x + workArea.width - w - 16;
      y = workArea.y + workArea.height - h;
    }
  } else {
    x = workArea.x + workArea.width - w - 16;
    y = workArea.y + workArea.height - h;
  }
  petWin.setPosition(Math.round(x), Math.round(y));
  // 初始穿透：鼠标未悬停时点击穿透到桌面
  petWin.setIgnoreMouseEvents(true, { forward: true });
}

function openChat() {
  if (chatWin) { chatWin.focus(); return; }
  chatWin = new BrowserWindow({
    width: 420,
    height: 660,
    minWidth: 340,
    minHeight: 500,
    frame: false,
    resizable: true,
    backgroundColor: '#FFF8E9',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  chatWin.loadFile(path.join(__dirname, 'ui', 'chat.html'));
  chatWin.on('closed', () => { chatWin = null; });
}

// 全局快捷键：显示/隐藏奶龙
function togglePet() {
  if (!petWin) { createPet(); return; }
  if (petWin.isVisible()) petWin.hide();
  else petWin.show();
}

function playFullscreen(payload) {
  if (fullWin) return;
  const { width, height, x, y } = screen.getPrimaryDisplay().bounds;
  const transparent = payload.mode === 'image'; // 图片模式透明背景（像挂件）；视频模式奶油色背景
  fullWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#FFF6E0',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  fullWin.setAlwaysOnTop(true, 'screen-saver');
  fullWin.loadFile(path.join(__dirname, 'ui', 'fullscreen.html'));
  fullWin.once('ready-to-show', () => fullWin.webContents.send('fullscreen-data', payload));
  fullWin.on('closed', () => { fullWin = null; });
}

// 讲解页：独立窗口，沙箱 + 禁止跳转与外链，页面只允许内联资源
function openExplainer(file) {
  const p = path.resolve(String(file));
  if (!p.startsWith(path.resolve(explainDir) + path.sep)) throw new Error('非法路径');
  if (explainWin && !explainWin.isDestroyed()) {
    explainWin.loadFile(p);
    explainWin.show();
    explainWin.focus();
    return true;
  }
  explainWin = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: '奶龙讲解',
    backgroundColor: '#FFFBF2',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  explainWin.setMenuBarVisibility(false);
  explainWin.loadFile(p);
  explainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  explainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  explainWin.on('closed', () => { explainWin = null; });
  return true;
}

// ---------- 托盘 ----------
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(assetsRoot, 'avatar', 'nailong-face-64.png'));
    if (icon.isEmpty()) throw new Error('缺少托盘图标 assets/avatar/nailong-face-64.png');
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('奶龙');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => openChat());
  } catch (e) {
    console.warn('[奶龙] 托盘不可用：', e.message);
  }
}
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开对话框', click: () => openChat() },
    { label: '显示/隐藏奶龙  (Ctrl+Alt+D)', click: () => togglePet() },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: config.openAtLogin, click: (i) => toggleAutoLaunch(i.checked) },
    { type: 'separator' },
    { label: '退出奶龙', click: () => app.quit() },
  ]);
}
function toggleAutoLaunch(on) {
  config.openAtLogin = on;
  saveConfig();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('asset-url', (_e, rel) => assetUrl(rel));
  ipcMain.handle('config-get', () => config);
  ipcMain.handle('config-set', (_e, patch) => { config = { ...config, ...patch }; saveConfig(); return config; });

  ipcMain.handle('ai-ask', (_e, q) => ai.answer(q, config));

  ipcMain.on('ai-ask-stream', async (event, { id, q }) => {
    const send = (p) => { if (!event.sender.isDestroyed()) event.sender.send('ai-stream', { id, ...p }); };
    const fixed = ai.matchFixed(q);
    if (fixed) { send({ delta: fixed }); send({ done: true }); return; }
    if (!config.apiKey) {
      send({ delta: '我还没有连上大脑哦～让主人在设置里填一下 DeepSeek Key，我就能陪你聊天啦！' });
      send({ done: true });
      return;
    }
    try {
      let systemPrompt;
      if (providers.shouldUse(q)) {
        systemPrompt = providers.buildSystem(q);
        send({ meta: { mode: 'providers' } });
      } else if (study.shouldUse(q)) {
        const ctx = study.buildStudyContext(q, config);
        systemPrompt = ctx.system;
        send({ meta: { mode: 'study', refs: ctx.refs.map((r) => ({ source: r.source, school: r.school })) } });
      }
      await ai.streamDeepSeek(String(q || '').trim(), config, (delta) => send({ delta }), systemPrompt);
      send({ done: true });
    } catch (e) {
      send({ error: e.message || String(e) });
    }
  });

  ipcMain.handle('explain-generate', async (_e, text) => {
    try {
      const html = await teach.generate(text, config);
      fs.mkdirSync(explainDir, { recursive: true });
      const file = path.join(explainDir, `explain-${Date.now()}.html`);
      fs.writeFileSync(file, html, 'utf8');
      openExplainer(file);
      return { ok: true, path: file };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
  const updateDir = path.join(app.getPath('temp'), 'nailong-update');

  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-check', async () => {
    try { return await updater.check(app.getVersion()); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('update-download', async (event, { url, mirrors, sha256 } = {}) => {
    try {
      const name = path.basename(new URL(String(url)).pathname) || 'nailong-update.exe';
      const dest = path.join(updateDir, name);
      const list = [String(url)].concat(Array.isArray(mirrors) ? mirrors : []);
      const res = await updater.download(list, dest, sha256, (received, total) => {
        if (!event.sender.isDestroyed()) event.sender.send('update-progress', { received, total });
      });
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('update-install', (_e, file) => {
    const target = path.resolve(String(file || ''));
    if (!target.startsWith(path.resolve(updateDir) + path.sep)) return { ok: false, error: '非法路径' };
    if (!fs.existsSync(target)) return { ok: false, error: '安装包不存在' };
    // 先退出主程序，再由 PowerShell 静默安装；首次失败时自动再跑一次（NSIS 原地覆盖的已知问题）
    const ps1 = path.join(updateDir, 'install-update.ps1');
    fs.writeFileSync(ps1, [
      'Start-Sleep -Seconds 2',
      'Start-Process -FilePath $args[0] -ArgumentList "/S" -Wait',
      '$dir = Join-Path $env:LOCALAPPDATA "Programs\\nailong"',
      '$exe = Get-ChildItem $dir -Filter *.exe | Where-Object { $_.Name -notlike "Uninstall*" } | Select-Object -First 1',
      'if (-not $exe) { Start-Process -FilePath $args[0] -ArgumentList "/S" -Wait; $exe = Get-ChildItem $dir -Filter *.exe | Where-Object { $_.Name -notlike "Uninstall*" } | Select-Object -First 1 }',
      'if ($exe) { Start-Process -FilePath $exe.FullName }',
    ].join('\r\n'), 'utf8');
    try {
      spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, target], {
        detached: true, stdio: 'ignore', windowsHide: true,
      }).unref();
    } catch (e) {
      return { ok: false, error: e.message };
    }
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  });

  ipcMain.handle('explain-open', (_e, file) => {
    try { return openExplainer(file); } catch (e) { return false; }
  });

  ipcMain.handle('video-generate', async (event, text) => {
    try {
      return await video.generate(text, config, videoDir, (p) => {
        if (!event.sender.isDestroyed()) event.sender.send('video-progress', p);
      });
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
  ipcMain.handle('video-open', (_e, file) => { try { shell.openPath(String(file)); return true; } catch { return false; } });

  ipcMain.handle('bili-search', async (_e, q) => {
    try { return await bili.search(q); } catch (e) { return { error: e.message || String(e) }; }
  });
  ipcMain.handle('open-external', (_e, url) => {
    const u = String(url || '');
    if (!/^(https?:|mailto:)/i.test(u)) return false;
    shell.openExternal(u);
    return true;
  });

  ipcMain.handle('save-note', async (_e, text) => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const r = await dialog.showSaveDialog(chatWin, {
      title: '保存为笔记',
      defaultPath: path.join(app.getPath('documents'), `奶龙笔记-${stamp}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const body = `# 奶龙学习笔记\n\n${String(text || '')}\n\n---\n${d.toLocaleString('zh-CN')} · 由奶龙整理\n`;
    fs.writeFileSync(r.filePath, body, 'utf8');
    return r.filePath;
  });

  ipcMain.handle('kb-import', async () => {
    const r = await dialog.showOpenDialog(chatWin, {
      title: '导入学习资料（讲义 / 试卷 / 笔记）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '学习资料', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }],
    });
    if (r.canceled) return [];
    const profile = config.profile || {};
    return kb.importFiles(r.filePaths, { school: profile.school || '', level: profile.level || '' });
  });
  ipcMain.handle('kb-list', () => kb.list());
  ipcMain.handle('kb-remove', (_e, id) => kb.remove(id));

  ipcMain.handle('conv-load', () => {
    try { return JSON.parse(fs.readFileSync(convPath, 'utf8')); } catch { return []; }
  });
  ipcMain.handle('conv-save', (_e, messages) => {
    try {
      fs.mkdirSync(path.dirname(convPath), { recursive: true });
      fs.writeFileSync(convPath, JSON.stringify(messages));
    } catch (e) { console.warn('[奶龙] 保存会话失败：', e.message); }
    return true;
  });
  ipcMain.handle('conv-clear', () => {
    try { fs.rmSync(convPath, { force: true }); } catch {}
    return true;
  });
  ipcMain.handle('tabs-load', () => {
    try { return JSON.parse(fs.readFileSync(tabsPath, 'utf8')); } catch { return null; }
  });
  ipcMain.handle('tabs-save', (_e, data) => {
    try {
      fs.mkdirSync(path.dirname(tabsPath), { recursive: true });
      fs.writeFileSync(tabsPath, JSON.stringify(data));
    } catch {}
    return true;
  });
  ipcMain.handle('tabs-clear', () => {
    try { fs.rmSync(tabsPath, { force: true }); } catch {}
    return true;
  });

  ipcMain.handle('avatar-pick', async () => {
    const r = await dialog.showOpenDialog(chatWin, {
      title: '选择头像',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      fs.copyFileSync(r.filePaths[0], avatarPath);
      config.userAvatar = true;
      saveConfig();
      return pathToFileURL(avatarPath).href;
    } catch { return null; }
  });
  ipcMain.handle('get-avatar-url', () =>
    config.userAvatar && fs.existsSync(avatarPath) ? pathToFileURL(avatarPath).href : null);

  ipcMain.handle('file-pick', async () => {
    const r = await dialog.showOpenDialog(chatWin, {
      title: '选择要发送的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (r.canceled) return [];
    fs.mkdirSync(filesDir, { recursive: true });
    const saved = [];
    for (const f of r.filePaths) {
      const n = path.basename(f);
      fs.copyFileSync(f, path.join(filesDir, n));
      saved.push(n);
    }
    return saved;
  });
  ipcMain.handle('file-list', () => {
    try {
      return fs.readdirSync(filesDir).map((n) => ({ name: n, isDir: fs.statSync(path.join(filesDir, n)).isDirectory() }));
    } catch { return []; }
  });
  // 防止路径穿越：只允许 filesDir 内的文件
  const safePath = (name) => {
    const p = path.resolve(filesDir, String(name));
    if (!p.startsWith(path.resolve(filesDir) + path.sep)) throw new Error('非法路径');
    return p;
  };
  ipcMain.handle('file-open', (_e, name) => shell.openPath(safePath(name)));
  ipcMain.handle('file-delete', (_e, name) => { fs.rmSync(safePath(name), { recursive: true }); return true; });
  ipcMain.handle('file-rename', (_e, oldName, newName) => {
    fs.renameSync(safePath(oldName), path.join(filesDir, path.basename(String(newName))));
    return true;
  });

  // 图片 OCR：本地 RapidOCR（需要系统 Python + rapidocr_onnxruntime）
  ipcMain.handle('ocr-file', (_e, name) => new Promise((resolve) => {
    let file;
    try { file = safePath(name); } catch (e) { resolve({ error: e.message }); return; }
    const py = process.env.NAILONG_PYTHON || 'python';
    execFile(py, [ocrScript, file], { encoding: 'utf8', timeout: 180000 },
      (err, stdout) => {
        if (err) { resolve({ error: err.message }); return; }
        try {
          const val = JSON.parse(String(stdout).trim());
          resolve(Array.isArray(val) ? val.join('\n') : val);
        } catch {
          resolve({ error: '识别结果解析失败' });
        }
      });
  }));

  ipcMain.handle('pet-apply', () => {
    if (!petWin || petWin.isDestroyed()) return false;
    const canvas = Math.min(640, Math.max(360, Number(config.petCanvas) || 480));
    petWin.setSize(canvas, canvas);
    positionPet();
    petWin.webContents.reload();
    return true;
  });
  ipcMain.handle('plugin-list', () => plugins.list(app.getVersion()));
  ipcMain.handle('plugin-commands', () => pluginHost.commands());
  ipcMain.handle('plugin-status', () => pluginHost.status());
  ipcMain.handle('plugin-run', (_e, name, args) => pluginHost.runCommand(name, args));
  ipcMain.handle('plugin-set-enabled', (_e, id, enabled) => {
    plugins.setEnabled(id, enabled);
    initPluginHost();
    return pluginHost.status();
  });
  ipcMain.handle('plugin-remove', (_e, id) => {
    plugins.remove(id);
    initPluginHost();
    return true;
  });
  ipcMain.handle('api-test', async () => {
    if (!config.apiKey) return { ok: false, error: '还没有填 API Key' };
    try {
      const text = await ai.askDeepSeek('只回复 ok 两个字母', config, '你是连通性测试助手，只回复 ok。', 0);
      return { ok: true, sample: String(text || '').slice(0, 40) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('provider-doc', () => {
    try {
      let status = null;
      try {
        status = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'docs', 'catalog-status.json'), 'utf8'));
      } catch {}
      return { ok: true, markdown: providers.doc(), status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('feedback-send', async (_e, payload) => {
    const text = String((payload && payload.text) || '').trim();
    const email = String((payload && payload.email) || '').trim();
    if (text.length < 3) return { ok: false, error: '请先写下问题或建议' };
    const body = {
      name: '奶龙用户',
      email: email || 'noreply@example.com',
      message: text,
      _subject: '奶龙问题反馈',
      _template: 'table',
      _captcha: 'false',
    };
    try {
      const res = await fetch('https://formsubmit.co/ajax/2491695554@qq.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const j = await res.json().catch(() => ({}));
      const success = j && (j.success === true || j.success === 'true');
      if (res.ok && success) {
        return { ok: true, needsConfirm: /confirm|激活|verify/i.test(String(j.message || '')) };
      }
      return {
        ok: false,
        error: (j && j.message) || `HTTP ${res.status}`,
        mailto: 'mailto:2491695554@qq.com?subject=' + encodeURIComponent('奶龙问题反馈') + '&body=' + encodeURIComponent(text),
      };
    } catch (e) {
      return {
        ok: false,
        error: e.message,
        mailto: 'mailto:2491695554@qq.com?subject=' + encodeURIComponent('奶龙问题反馈') + '&body=' + encodeURIComponent(text),
      };
    }
  });

  ipcMain.handle('store-list', async () => {
    try { return { ok: true, items: await store.list(app.getVersion()) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('store-install', async (_e, id) => {
    try {
      const items = await store.list(app.getVersion());
      const entry = items.find((p) => p.id === id);
      if (!entry) return { ok: false, error: '商店里没有这个插件' };
      const m = await store.install(entry, {
        appVersion: app.getVersion(),
        tmpRoot: path.join(app.getPath('temp'), 'nailong-store'),
      });
      initPluginHost();
      return { ok: true, plugin: m };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on('pet-hover', (_e, hovering) => {
    if (!petWin) return;
    if (hovering) petWin.setIgnoreMouseEvents(false);
    else petWin.setIgnoreMouseEvents(true, { forward: true });
  });
  // 拖拽：主进程直接跟随系统鼠标（12ms 一帧），不经过渲染进程的 mousemove IPC
  let petDragTimer = null;
  ipcMain.on('pet-drag-start', () => {
    if (!petWin) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = petWin.getPosition();
    const offX = cursor.x - wx;
    const offY = cursor.y - wy;
    clearInterval(petDragTimer);
    petDragTimer = setInterval(() => {
      if (!petWin || petWin.isDestroyed()) return;
      const c = screen.getCursorScreenPoint();
      petWin.setPosition(Math.round(c.x - offX), Math.round(c.y - offY));
    }, 12);
  });
  ipcMain.on('pet-drag-end', () => {
    clearInterval(petDragTimer);
    petDragTimer = null;
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    config.petPosition = { x, y };
    saveConfig();
  });
  // 兼容旧接口
  ipcMain.on('pet-move', (_e, dx, dy) => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    petWin.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('pet-move-end', () => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    config.petPosition = { x, y };
    saveConfig();
  });
  ipcMain.on('pet-singleclick', () => openChat());
  ipcMain.on('pet-doubleclick', () => {
    const d = new Date();
    const celebrate = d.getMonth() === 8 && d.getDate() === 23; // 每年 9 月 23 日
    if (celebrate) {
      playFullscreen({
        mode: 'video',
        intro: assetUrl('pet/celebrate-1.mp4'),
        loop: assetUrl('pet/celebrate-2.mp4'),
        music: assetUrl('pet/birthday.mp3'),
      });
    } else {
      playFullscreen({ mode: 'image', image: assetUrl('pet/wink-large.webp') });
    }
  });
  ipcMain.on('fullscreen-close', () => { if (fullWin) fullWin.close(); });
  ipcMain.on('chat-close', () => { if (chatWin) chatWin.close(); });
}

// 开发用：electron . --capture 生成界面截图到 shots/ 后退出，不影响正常启动
async function captureUi() {
  const out = path.join(__dirname, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, name) => {
    for (let i = 0; i < 4; i++) {
      try {
        fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
        return;
      } catch (e) {
        console.warn('[capture]', name, 'retry', i + 1, e.message);
        await wait(500);
      }
    }
  };
  try {
    await wait(2200);
    if (petWin) {
      await shot(petWin, 'pet.png');
      await petWin.webContents.executeJavaScript("setPose('sleep')");
      await wait(700);
      await shot(petWin, 'pet-sleep.png');
      await petWin.webContents.executeJavaScript("setPose('sleep'); say('我的大肚肚，真的很酷酷！')");
      await wait(500);
      await shot(petWin, 'pet-bubble.png');
      await petWin.webContents.executeJavaScript("document.body.classList.add('hover')");
      await wait(420);
      await shot(petWin, 'pet-hover.png');
      await petWin.webContents.executeJavaScript("document.body.classList.remove('hover'); document.body.classList.add('dragging'); setPose('stand')");
      await wait(500);
      await shot(petWin, 'pet-drag.png');
      await petWin.webContents.executeJavaScript("document.body.classList.remove('dragging'); document.body.style.setProperty('--pet-scale', 1.8); setPose('stand')");
      await wait(500);
      await shot(petWin, 'pet-scale.png');
      await petWin.webContents.executeJavaScript("document.body.style.setProperty('--pet-scale', 1); setPose('sleep')");
    }
    try { fs.rmSync(convPath, { force: true }); } catch {}
    try { fs.rmSync(tabsPath, { force: true }); } catch {}
    openChat();
    await wait(1200);
    chatWin.show();
    chatWin.focus();
    await wait(400);
    await shot(chatWin, 'chat-empty.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#settings-btn').click()");
    await wait(400);
    await shot(chatWin, 'chat-settings.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#cancel-key').click()");
    await wait(250);
    await chatWin.webContents.executeJavaScript("document.querySelector('#settings-btn').click(); document.querySelector('#open-provider-doc').click()");
    await wait(1000);
    await shot(chatWin, 'chat-doc.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#doc-close').click(); document.querySelector('#open-feedback').click()");
    await wait(400);
    await shot(chatWin, 'chat-feedback.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#feedback-cancel').click(); document.querySelector('#cancel-key').click()");
    await wait(250);
    await chatWin.webContents.executeJavaScript("document.querySelector('#plugins-btn').click()");
    await wait(500);
    await shot(chatWin, 'chat-plugins.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#plugins-modal').classList.remove('open'); runPluginCommand('hello','')");
    await wait(800);
    await shot(chatWin, 'chat-panel.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#panel-modal').classList.remove('open'); document.querySelector('#plugins-btn').click(); document.querySelector('.ptab[data-tab=store]').click()");
    await wait(1800);
    await shot(chatWin, 'chat-store.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#plugins-modal').classList.remove('open'); runPluginCommand('bili','线性代数')");
    await wait(1800);
    await shot(chatWin, 'chat-bili.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#panel-modal').classList.remove('open')");
    await wait(250);
    await chatWin.webContents.executeJavaScript(`(() => {
      document.querySelector('#study-btn').click();
      document.querySelector('#p-level').value = '本科';
      document.querySelector('#p-region').value = '北京';
      document.querySelector('#p-school').value = '北京邮电大学';
      document.querySelector('#p-major').value = '人工智能';
      document.querySelector('#p-grade').value = '大二';
    })()`);
    await wait(500);
    await shot(chatWin, 'chat-study.png');
    await chatWin.webContents.executeJavaScript("document.querySelector('#study-close').click()");
    await wait(300);
    await chatWin.webContents.executeJavaScript(`(async () => {
      addMsg('me', '我是北邮的，人工智能数学方法这门课怎么学？', { restore: true });
      addMsg('nailong', '# 可以这样安排\\n\\n先把 **线性代数** 和 **概率论** 捡回来，再进入矩阵求导。\\n\\n| 阶段 | 重点 | 产出 |\\n|---|---|---|\\n| 1 | 矩阵求导 | 手推 10 道 |\\n| 2 | 凸优化 | 一页笔记 |\\n\\n\`\`\`python\\nimport numpy as np\\nprint(np.eye(3))\\n\`\`\`\\n\\n> 每天 1 小时，先看懂再刷题。', { restore: true });
      addMsg('me', '收到，谢谢奶龙！', { restore: true });
      addMsg('nailong', '嘿嘿，我的大肚肚里全是知识～', { restore: true });
    })()`);
    await wait(600);
    await shot(chatWin, 'chat.png');
    await chatWin.webContents.executeJavaScript("createTab(); addMsg('me','帮我做一份期末复习计划'); addMsg('nailong','好的，先按 4 周排：第 1 周过一遍知识点，第 2 周做题…')");
    await wait(500);
    await shot(chatWin, 'chat-tabs.png');
  } catch (e) {
    console.error('[capture] failed:', e);
  } finally {
    await wait(200);
    app.quit();
  }
}

// 开发用：electron . --selftest 跑一次「发消息→渲染」的最短回归，退出码即结果
async function selfTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const askIdx = process.argv.indexOf('--ask');
  const question = askIdx > 0 ? process.argv[askIdx + 1] : '你是谁';
  const isDefault = question === '你是谁';
  try {
    try { fs.rmSync(convPath, { force: true }); } catch {}
    try { fs.rmSync(tabsPath, { force: true }); } catch {}
    openChat();
    await wait(1500);
    await chatWin.webContents.executeJavaScript(
      `document.querySelector('#input').value=${JSON.stringify(question)};document.querySelector('#send').click();`);
    for (let i = 0; i < 240; i++) {
      await wait(500);
      const done = await chatWin.webContents.executeJavaScript("!document.querySelector('#send').disabled");
      if (done) break;
    }
    const text = await chatWin.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('.msg.nailong .bubble')).map((e) => e.innerText).join('|')");
    const ok = isDefault ? text.includes('我是奶龙') : text.trim().length > 20;
    console.log('[selftest]', ok ? 'PASS' : 'FAIL', JSON.stringify(text.slice(0, 2500)));
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('[selftest] ERROR', e);
    app.exit(2);
  }
}

app.whenReady().then(() => {
  if (!gotSingleLock) return;
  unlockSecrets();
  registerIpc();
  createPet();
  createTray();
  initPluginHost();
  if (process.argv.includes('--storetest')) {
    (async () => {
      try {
        const items = await store.list(app.getVersion());
        console.log('[storetest] items=', items.map((i) => `${i.id}@${i.version}`).join(','));
        const m = await store.install(items[0], {
          appVersion: app.getVersion(),
          tmpRoot: path.join(app.getPath('temp'), 'nailong-store-test'),
        });
        console.log('[storetest] installed=', m.id, m.version);
        initPluginHost();
        const r = await pluginHost.runCommand('bili', '线性代数 怎么学');
        console.log('[storetest] run=', JSON.stringify(r).slice(0, 500));
        app.exit(r.ok ? 0 : 1);
      } catch (e) {
        console.error('[storetest] ERR', e.message);
        app.exit(2);
      }
    })();
    return;
  }
  if (process.argv.includes('--plugintest')) {
    (async () => {
      try {
        console.log('[plugintest] status=', JSON.stringify(pluginHost.status()));
        const r = await pluginHost.runCommand('hello', '');
        console.log('[plugintest] result=', JSON.stringify(r));
        app.exit(r.ok ? 0 : 1);
      } catch (e) {
        console.error('[plugintest] ERR', e.message);
        app.exit(2);
      }
    })();
    return;
  }
  if (process.argv.includes('--updatetest')) {
    (async () => {
      try {
        const r = await updater.check('1.0.0');
        console.log('[updatetest] latest=', r.latest, 'url=', r.app.url);
        const dest = path.join(app.getPath('temp'), 'nailong-update-test.exe');
        const res = await updater.download([r.app.url].concat(r.app.mirrors || []), dest, r.app.sha256,
          (recv, total) => { if (total) console.log('[updatetest]', Math.round(recv / total * 100) + '%'); });
        console.log('[updatetest] OK sha=' + res.sha + ' size=' + res.size);
        app.exit(0);
      } catch (e) {
        console.error('[updatetest] ERR', e.message);
        app.exit(1);
      }
    })();
    return;
  }
  if (process.argv.includes('--capture')) { captureUi(); return; }
  if (process.argv.includes('--selftest')) { selfTest(); return; }
  if (process.argv.includes('--muxonly')) {
    const i = process.argv.indexOf('--muxonly');
    video.finish(process.argv[i + 1])
      .then((f) => { console.log('[muxonly] OK', f); app.exit(0); })
      .catch((e) => { console.error('[muxonly] ERROR', e.message); app.exit(1); });
    return;
  }
  if (process.argv.includes('--videotest')) {
    const i = process.argv.indexOf('--videotest');
    video.generate(process.argv[i + 1] || '勾股定理', config, videoDir, (p) => console.log('[video]', p.pct, p.msg))
      .then((r) => { console.log('[videotest]', JSON.stringify(r)); app.exit(0); })
      .catch((e) => { console.error('[videotest] ERROR', e.message); app.exit(1); });
    return;
  }
  if (app.isPackaged && config.openAtLogin) app.setLoginItemSettings({ openAtLogin: true });
  // 全局快捷键：Ctrl+Alt+D 显示/隐藏奶龙
  const ok = globalShortcut.register('CommandOrControl+Alt+D', togglePet);
  if (!ok) console.warn('[奶龙] 快捷键 Ctrl+Alt+D 注册失败（可能被其他程序占用）');
});

// 常驻托盘，关闭所有窗口不退出（靠托盘「退出奶龙」退出）
app.on('window-all-closed', () => {});
