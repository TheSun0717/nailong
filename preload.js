const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nailong', {
  // 通用
  getAsset: (name) => ipcRenderer.invoke('asset-url', name),
  getConfig: () => ipcRenderer.invoke('config-get'),
  setConfig: (patch) => ipcRenderer.invoke('config-set', patch),

  // AI
  ask: (q) => ipcRenderer.invoke('ai-ask', q),
  askStream: (id, q, history) => ipcRenderer.send('ai-ask-stream', { id, q, history }),
  onStream: (cb) => ipcRenderer.on('ai-stream', (_e, p) => cb(p)),

  // 会话
  loadConversation: () => ipcRenderer.invoke('conv-load'),
  saveConversation: (messages) => ipcRenderer.invoke('conv-save', messages),
  clearConversation: () => ipcRenderer.invoke('conv-clear'),
  loadTabs: () => ipcRenderer.invoke('tabs-load'),
  saveTabs: (data) => ipcRenderer.invoke('tabs-save', data),
  clearTabs: () => ipcRenderer.invoke('tabs-clear'),

  // 学习知识库
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  generateExplainer: (payload) => ipcRenderer.invoke('explain-generate', payload),
  openExplainer: (file) => ipcRenderer.invoke('explain-open', file),
  listArtifacts: () => ipcRenderer.invoke('artifacts-list'),
  openArtifact: (file) => ipcRenderer.invoke('artifact-open', file),
  generateVideo: (text) => ipcRenderer.invoke('video-generate', text),
  onVideoProgress: (cb) => ipcRenderer.on('video-progress', (_e, p) => cb(p)),
  openVideo: (file) => ipcRenderer.invoke('video-open', file),
  importStudyFiles: () => ipcRenderer.invoke('kb-import'),
  listKnowledge: () => ipcRenderer.invoke('kb-list'),
  removeKnowledge: (id) => ipcRenderer.invoke('kb-remove', id),
  searchBilibili: (q) => ipcRenderer.invoke('bili-search', q),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 头像
  pickAvatar: () => ipcRenderer.invoke('avatar-pick'),
  getAvatarUrl: () => ipcRenderer.invoke('get-avatar-url'),

  // 文件
  pickFile: () => ipcRenderer.invoke('file-pick'),
  listFiles: () => ipcRenderer.invoke('file-list'),
  openFile: (name) => ipcRenderer.invoke('file-open', name),
  ocrFile: (name) => ipcRenderer.invoke('ocr-file', name),
  deleteFile: (name) => ipcRenderer.invoke('file-delete', name),
  renameFile: (oldName, newName) => ipcRenderer.invoke('file-rename', oldName, newName),

  // 宠物窗口交互
  applyPetSettings: () => ipcRenderer.invoke('pet-apply'),

  // 插件
  listPlugins: () => ipcRenderer.invoke('plugin-list'),
  pluginCommands: () => ipcRenderer.invoke('plugin-commands'),
  pluginStatus: () => ipcRenderer.invoke('plugin-status'),
  runPluginCommand: (name, args) => ipcRenderer.invoke('plugin-run', name, args),
  autoPlugin: (q) => ipcRenderer.invoke('plugin-auto', q),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugin-set-enabled', id, enabled),
  removePlugin: (id) => ipcRenderer.invoke('plugin-remove', id),
  storeList: () => ipcRenderer.invoke('store-list'),
  storeInstall: (id) => ipcRenderer.invoke('store-install', id),
  workshopGenerate: (desc) => ipcRenderer.invoke('workshop-generate', desc),
  workshopInstall: (spec) => ipcRenderer.invoke('workshop-install', spec),
  getProviderDoc: () => ipcRenderer.invoke('provider-doc'),
  testApi: () => ipcRenderer.invoke('api-test'),
  sendFeedback: (payload) => ipcRenderer.invoke('feedback-send', payload),
  onPetSay: (cb) => ipcRenderer.on('pet-say', (_e, t) => cb(t)),
  onPluginNotify: (cb) => ipcRenderer.on('plugin-notify', (_e, t) => cb(t)),

  // 更新
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  minimize: () => ipcRenderer.invoke('win-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win-toggle-max'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: (url, mirrors, sha256) => ipcRenderer.invoke('update-download', { url, mirrors, sha256 }),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  installUpdate: (file) => ipcRenderer.invoke('update-install', file),
  petHover: (hovering) => ipcRenderer.send('pet-hover', hovering),
  dragStart: () => ipcRenderer.send('pet-drag-start'),
  dragEnd: () => ipcRenderer.send('pet-drag-end'),
  movePet: (dx, dy) => ipcRenderer.send('pet-move', dx, dy),
  moveEnd: () => ipcRenderer.send('pet-move-end'),
  singleClick: () => ipcRenderer.send('pet-singleclick'),
  doubleClick: () => ipcRenderer.send('pet-doubleclick'),

  // 全屏（视频/图片）
  onFullscreen: (cb) => ipcRenderer.on('fullscreen-data', (_e, p) => cb(p)),
  closeFullscreen: () => ipcRenderer.send('fullscreen-close'),

  // 关闭对话框
  closeChat: () => ipcRenderer.send('chat-close'),
});
