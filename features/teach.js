// 教学可视化：把一个知识点/题目生成为自包含的单文件 HTML 讲解页
const ai = require('../ai');

const SYSTEM = `你是「奶龙」的教学可视化模式，负责把知识点或题目做成一个可以直接看懂的单文件 HTML 讲解页。

硬性要求：
1. 只输出完整 HTML（从 <!DOCTYPE html> 到 </html>），不要解释、不要 Markdown 代码围栏。
2. 所有 CSS 和 JS 内联；不引用任何外部资源（无 CDN、无网络字体、无外链图片、无 MathJax）。公式只用 HTML 表示（上标用 <sup>、下标用 <sub>），禁止出现 LaTeX 定界符（\\( \\)、\\[ \\]、$...$）。
3. 中文；内容必须准确；如果是一道题，给出完整解答。
4. 页面结构固定为：
   - 顶部标题 + 一句话「学完你会什么」+ 学科标签；
   - 核心概念区：一个手写 SVG 示意图（用图形表达关系，不要用 emoji 当插图）；
   - 分步讲解区：3 到 6 步，点「下一步」逐步展开，带进度点、上一步/下一步/重置按钮，支持 ← → 方向键；
   - 易错点区：2 到 4 条；
   - 30 秒自测：1 到 2 个问题，答案可展开。
5. 动效克制：步骤切换 200-300ms 过渡，不闪烁；尊重 prefers-reduced-motion。
6. 版式：奶油底色 #FFFBF2、正文色 #2E2419、强调色 #F2A81D、图示辅助色 #3B6EA5；圆角 16px，留白充足；适配 1100x800 和手机宽度。
7. 不写「示意图」「示例」「本页由 AI 生成」这类制作说明；页面上不出现未实现的功能。
8. SVG 必须完整闭合，坐标在 viewBox 内；核心概念区最多画 2 个主体图形；标签放在图形外侧；文字与文字、文字与图形之间至少留 32px，不允许重叠；文字不要溢出。

只输出 HTML。`;

function extractHtml(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<!DOCTYPE|<html/i);
  if (start < 0) return '';
  s = s.slice(start);
  const end = s.toLowerCase().lastIndexOf('</html>');
  if (end > 0) s = s.slice(0, end + 7);
  return s;
}

// 生成页只允许内联资源，禁止联网/本地文件读取；顺手去掉模型残留的 LaTeX 定界符
function lockDown(html) {
  let out = String(html)
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1');
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; font-src data:">';
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + '\n' + csp);
  else out = csp + out;
  return out;
}

async function generate(question, config) {
  const raw = await ai.askDeepSeek(String(question || '').trim(), config, SYSTEM, 0.5);
  const html = extractHtml(raw);
  if (!html || html.length < 400) throw new Error('模型没有返回完整讲解页，再试一次吧');
  return lockDown(html);
}

module.exports = { generate, extractHtml, lockDown, SYSTEM };
