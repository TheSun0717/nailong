const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nailong', {
  // 通用
  getAsset: (name) => ipcRenderer.invoke('asset-url', name),
  getConfig: () => ipcRenderer.invoke('config-get'),
  setConfig: (patch) => ipcRenderer.invoke('config-set', patch),

  // AI
  ask: (q) => ipcRenderer.invoke('ai-ask', q),
  askStream: (id, q) => ipcRenderer.send('ai-ask-stream', { id, q }),
  onStream: (cb) => ipcRenderer.on('ai-stream', (_e, p) => cb(p)),

  // 会话
  loadConversation: () => ipcRenderer.invoke('conv-load'),
  saveConversation: (messages) => ipcRenderer.invoke('conv-save', messages),
  clearConversation: () => ipcRenderer.invoke('conv-clear'),

  // 学习知识库
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  generateExplainer: (text) => ipcRenderer.invoke('explain-generate', text),
  openExplainer: (file) => ipcRenderer.invoke('explain-open', file),
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
