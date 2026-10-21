// B 站公开搜索（无需登录）：给学习问题补充公开课视频
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

let cookieCache = '';
async function getCookie() {
  if (cookieCache) return cookieCache;
  const res = await fetch('https://www.bilibili.com/', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  cookieCache = (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0])
    .join('; ');
  return cookieCache;
}

function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function search(query, limit = 6) {
  const q = String(query || '').replace(/[？?。！!，,]/g, ' ').trim().slice(0, 60);
  if (!q) return [];
  const cookie = await getCookie();
  const url = 'https://api.bilibili.com/x/web-interface/search/type?' +
    new URLSearchParams({ search_type: 'video', keyword: q, page: '1' });
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`B站搜索失败（${res.status}）`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`B站搜索失败（code ${data.code}）`);
  const items = (data.data && data.data.result) || [];
  return items.filter((x) => x.bvid).slice(0, limit).map((x) => ({
    title: clean(x.title),
    up: clean(x.author),
    play: Number(x.play) || 0,
    bvid: x.bvid,
    url: `https://www.bilibili.com/video/${x.bvid}`,
  }));
}

module.exports = { search };
