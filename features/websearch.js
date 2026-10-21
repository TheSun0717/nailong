// 全网经验搜索（应用内置浏览器 + Bing site: 限定）。
// 不需要登录、不依赖 OpenCLI；结果来自公开搜索页。
const { BrowserWindow } = require('electron');

const SITES = {
  zhihu: { domain: 'zhihu.com', label: '知乎' },
  douban: { domain: 'douban.com', label: '豆瓣' },
  tieba: { domain: 'tieba.baidu.com', label: '贴吧' },
  weibo: { domain: 'weibo.com', label: '微博' },
  nowcoder: { domain: 'nowcoder.com', label: '牛客' },
  csdn: { domain: 'csdn.net', label: 'CSDN' },
  juejin: { domain: 'juejin.cn', label: '掘金' },
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
let win = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1080,
    height: 820,
    show: false,
    title: '资料搜索 · 奶龙',
    webPreferences: {
      partition: 'persist:nailong-web',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
  return win;
}

function isSite(platform) {
  return Object.prototype.hasOwnProperty.call(SITES, String(platform || '').toLowerCase());
}

async function search(platform, keyword, { timeoutMs = 60000 } = {}) {
  const key = String(platform || '').toLowerCase();
  const site = SITES[key];
  if (!site) throw new Error('不支持的平台：' + platform);
  const q = String(keyword || '').trim();
  if (!q) throw new Error('请提供搜索关键词');

  const cacheKey = key + ':' + q;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.rows;

  const url = 'https://cn.bing.com/search?setlang=zh-CN&q=' +
    encodeURIComponent(`site:${site.domain} ${q}`);
  const w = open();
  await w.loadURL(url);

  const deadline = Date.now() + timeoutMs;
  let state = { n: 0, captcha: false };
  while (Date.now() < deadline) {
    if (w.isDestroyed()) throw new Error('搜索窗口被关闭了');
    state = await w.webContents.executeJavaScript(`(() => {
      const n = document.querySelectorAll('li.b_algo h2 a').length;
      const text = document.body ? document.body.innerText : '';
      return { n, captcha: /验证码|异常流量|captcha|Verify/i.test(text) };
    })()`);
    if (state.n > 0) break;
    if (state.captcha) throw new Error('搜索触发了验证，请稍后再试');
    await sleep(600);
  }
  if (!state.n) throw new Error('没有拿到搜索结果，请稍后再试');
  await sleep(800);

  const rows = await w.webContents.executeJavaScript(`(() => {
    return [...document.querySelectorAll('li.b_algo')].slice(0, 8).map((li) => {
      const a = li.querySelector('h2 a') || li.querySelector('a');
      const p = li.querySelector('p, .b_caption p');
      return {
        title: a ? a.innerText.trim() : '',
        url: a ? a.href : '',
        snippet: p ? p.innerText.trim() : '',
      };
    }).filter((x) => x.title && x.url);
  })()`);

  const out = rows.map((r) => ({
    title: r.title,
    subtitle: `${site.label} · ${r.snippet.slice(0, 80)}`,
    url: r.url,
  }));
  cache.set(cacheKey, { ts: Date.now(), rows: out });
  return out;
}

module.exports = { search, open, isSite, SITES };
