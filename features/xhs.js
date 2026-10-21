// 小红书搜索（应用内置浏览器）：独立持久会话，用户登录一次后自动提取搜索结果。
// 不读取系统 Chrome 的 Cookie，不需要 OpenCLI 扩展。
const { BrowserWindow } = require('electron');

const PARTITION = 'persist:nailong-xhs';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
let win = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1080,
    height: 820,
    show: true,
    title: '小红书 · 奶龙',
    autoHideMenuBar: true,
    backgroundColor: '#FFF8E9',
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
  return win;
}

function searchUrl(keyword) {
  return 'https://www.xiaohongshu.com/search_result?source=web_explore_feed&keyword=' +
    encodeURIComponent(String(keyword || ''));
}

async function state(w) {
  if (!w || w.isDestroyed()) return { cards: 0, login: false, captcha: false, url: '' };
  try {
    return await w.webContents.executeJavaScript(`(() => {
      const cards = document.querySelectorAll('section.note-item').length;
      const body = document.body ? document.body.innerText : '';
      return {
        cards,
        login: /登录后查看搜索结果|登录后查看/.test(body) || !!document.querySelector('#login-btn'),
        captcha: /请求太频繁|访问频次异常|安全限制/.test(body),
        url: location.href,
      };
    })()`);
  } catch {
    return { cards: 0, login: false, captcha: false, url: '' };
  }
}

async function extract(w) {
  return w.webContents.executeJavaScript(`(() => {
    return [...document.querySelectorAll('section.note-item')].slice(0, 10).map((s) => {
      const a = s.querySelector('a[href*="/search_result/"]') || s.querySelector('a[href*="/explore/"]');
      const lines = (s.innerText || '').split('\\n').map((x) => x.trim()).filter(Boolean);
      return { title: lines[0] || '', author: lines[1] || '', likes: lines[3] || '', url: a ? a.href : '' };
    }).filter((x) => x.title);
  })()`);
}

async function search(keyword, { timeoutMs = 180000 } = {}) {
  const q = String(keyword || '').trim();
  if (!q) throw new Error('请提供小红书搜索关键词');
  const cached = cache.get(q);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.rows;

  const w = open();
  w.show();
  w.focus();
  await w.loadURL(searchUrl(q));

  const deadline = Date.now() + timeoutMs;
  let st = await state(w);
  let sawLogin = st.login;
  while (Date.now() < deadline) {
    if (w.isDestroyed()) throw new Error('小红书窗口被关闭了');
    st = await state(w);
    if (st.captcha) throw new Error('小红书触发了安全验证，请在小红书窗口里完成验证后再试');
    if (st.cards > 0) break;
    if (st.login) sawLogin = true;
    await sleep(1500);
  }
  if (!st.cards) {
    throw new Error(sawLogin
      ? '需要先在小红书窗口里登录；登录后窗口会自动继续，也可以再运行一次 /xhs'
      : '没有拿到搜索结果（可能需要登录或稍后再试）');
  }

  const rows = await extract(w);
  cache.set(q, { ts: Date.now(), rows });
  w.hide();
  return rows;
}

function close() {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

module.exports = { search, open, state, searchUrl, extract, close };
