// 教学可视化 v2：结构化解题 → 二次校验 → 固定动画模板（SVG 图示 + 分步动画）。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

let nativeImage = null;
try { nativeImage = require('electron').nativeImage; } catch (_) {}
const ai = require('../ai');

const SOLVE_SYSTEM = `你是严谨的学科老师。解出题目并输出一张「解题卡」JSON，只输出 JSON，不要 Markdown 围栏。

结构：
{
  "title": "标题",
  "subject": "学科",
  "question": "题目（原样或整理后）",
  "intuition": "用一句大白话说清这题在干什么",
  "analogy": "一个生活化的比喻，帮助理解",
  "given": ["已知条件1", "..."],
  "steps": [
    {
      "title": "这一步做什么",
      "body": "为什么这样做，讲清楚",
      "formula": "关键公式（普通文本，可用 ^ 表示上标）",
      "visual": { "type": "triangle|axes|flow|none", "data": { } }
    }
  ],
  "answer": "最终答案",
  "pitfalls": ["易错点1", "..."],
  "checkpoint": "一句话自测",
  "checks": [{"expr": "3^2+4^2", "equals": "25", "vars": {}}]
}

要求：
- 假设读者是小学生：术语第一次出现时用一句大白话解释；每步尽量配一个生活化比喻；不跳步。
- 每一步都必须可验证；先写已知，再推导，最后给答案。
- 如果题目带图，先根据图写出已知条件，再做。
- visual 用来画示意图：
  - triangle: {"a":"3","b":"4","c":"5","aLabel":"3","bLabel":"4","cLabel":"5"}（只用于直角三角形）
  - axes: {"points":[{"x":0,"y":0,"label":"O"}],"curve":{"type":"line|parabola","a":1,"b":0,"c":0}}
  - flow: {"nodes":["步骤A","步骤B","步骤C"]}
  - circle: {"r":"5","angle":"60","label":"r=5"}
  - numberline: {"min":-3,"max":3,"marks":[{"x":0,"label":"0"},{"x":2,"label":"2"}]}
  - vectors: {"vectors":[{"label":"重力","angle":-90,"length":100},{"label":"拉力","angle":60,"length":80}]}（物理受力/速度，angle 为角度，length 为像素长度）
  - 不需要图就用 {"type":"none"}
- 公式不要用 LaTeX 定界符；用普通文本。
- 每个步骤的 visual 都必须给；至少两个步骤要有图示（triangle/axes/flow/circle/numberline/vectors），不能全是 none。
- checks 至少给一条对最终答案的数值验算（expr/equals 用普通运算符，^ 表示乘方，vars 可选）；没有可验算的式子就给空数组。
- 只输出 JSON。`;

const VERIFY_SYSTEM = `你是严格的阅卷老师。检查下面解题卡的每一步推导和最终答案是否正确、是否与题目条件一致。

只输出 JSON：
{"ok": true/false, "issues": ["问题1", "..."], "corrected": {完整修正后的解题卡，结构同输入}}

要求：
- 如果答案或任一步骤有错，ok=false，并在 corrected 里给出修正后的完整解题卡。
- 如果没有错误，ok=true，corrected 可以为 null。
- corrected 必须保持同样的 JSON 结构。`;

function extractJson(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function isSpec(v) {
  return v && typeof v === 'object' && Array.isArray(v.steps) && v.steps.length > 0;
}

function normalizeSpec(spec) {
  const s = spec || {};
  const steps = (Array.isArray(s.steps) ? s.steps : []).slice(0, 10).map((st) => ({
    title: String((st && st.title) || '').slice(0, 80),
    body: String((st && st.body) || '').slice(0, 600),
    formula: String((st && st.formula) || '').slice(0, 200),
    visual: st && st.visual && typeof st.visual === 'object' ? st.visual : { type: 'none', data: {} },
  }));
  return {
    title: String(s.title || '知识点讲解').slice(0, 80),
    subject: String(s.subject || '学习').slice(0, 20),
    question: String(s.question || '').slice(0, 400),
    intuition: String(s.intuition || '').slice(0, 200),
    analogy: String(s.analogy || '').slice(0, 200),
    given: (Array.isArray(s.given) ? s.given : []).slice(0, 8).map((x) => String(x).slice(0, 120)),
    steps,
    answer: String(s.answer || '').slice(0, 400),
    pitfalls: (Array.isArray(s.pitfalls) ? s.pitfalls : []).slice(0, 6).map((x) => String(x).slice(0, 160)),
    checkpoint: String(s.checkpoint || '').slice(0, 200),
    checks: (Array.isArray(s.checks) ? s.checks : []).slice(0, 6).filter((c) => c && c.expr).map((c) => ({
      expr: String(c.expr).slice(0, 200),
      equals: String(c.equals == null ? '0' : c.equals).slice(0, 200),
      vars: c.vars && typeof c.vars === 'object' ? c.vars : {},
    })),
  };
}

function imageData(file) {
  try {
    if (nativeImage) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) {
        const size = img.getSize();
        const resized = size.width > 900 ? img.resize({ width: 900 }) : img;
        return 'data:image/jpeg;base64,' + resized.toJPEG(82).toString('base64');
      }
    }
  } catch (_) {}
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function solve(topic, config, imagePath, temperature = 0.2) {
  const prompt = `${SOLVE_SYSTEM}\n\n题目/知识点：\n${topic}`;
  let raw;
  if (imagePath) {
    try {
      raw = await ai.askWithImage(prompt, config, SOLVE_SYSTEM, imageData(imagePath), temperature);
    } catch (_) {
      raw = await ai.askDeepSeek(prompt, config, SOLVE_SYSTEM, temperature, { json: true });
    }
  } else {
    raw = await ai.askDeepSeek(prompt, config, SOLVE_SYSTEM, temperature, { json: true });
  }
  const spec = extractJson(raw);
  if (!isSpec(spec)) throw new Error('模型没有返回解题卡');
  return normalizeSpec(spec);
}

// 三角形图示自动追加勾股校验（只对数字标签生效）
function augmentChecks(spec) {
  const checks = Array.isArray(spec.checks) ? spec.checks.slice() : [];
  const seen = new Set(checks.map((c) => `${c.expr}=${c.equals}`));
  const num = (v) => {
    const m = String(v == null ? '' : v).replace(/[^0-9.]/g, '');
    const n = Number(m);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  for (const st of spec.steps || []) {
    const v = st.visual;
    if (!v || v.type !== 'triangle' || !v.data) continue;
    const a = num(v.data.aLabel || v.data.a);
    const b = num(v.data.bLabel || v.data.b);
    const c = num(v.data.cLabel || v.data.c);
    if (!a || !b || !c) continue;
    const key = `${a}^2+${b}^2=${c}^2`;
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push({ expr: `${a}^2+${b}^2`, equals: `${c}^2`, vars: {} });
    const triKey = `tri:${a},${b},${c}`;
    if (!seen.has(triKey)) {
      seen.add(triKey);
      checks.push({ type: 'triangle', a, b, c });
    }
  }
  return { ...spec, checks: checks.slice(0, 8) };
}

function runChecks(checks, script, pythonExe) {
  return new Promise((resolve) => {
    if (!Array.isArray(checks) || !checks.length || !script || !fs.existsSync(script)) {
      return resolve({ allOk: true, note: '', failed: [] });
    }
    execFile(pythonExe || 'python', [script, JSON.stringify({ checks })], { encoding: 'utf8', timeout: 30000 }, (err, stdout) => {
      if (err) return resolve({ allOk: true, note: '', failed: [] });
      try {
        const r = JSON.parse(String(stdout).trim());
        const results = r.results || [];
        const failed = results.filter((x) => !x.ok);
        return resolve({
          allOk: !!r.ok,
          note: r.ok ? `已通过 ${results.length} 项符号验算` : '',
          failed: failed.map((x) => x.type === 'triangle'
            ? `三角形 ${x.a}/${x.b}/${x.c} 不满足三角形不等式`
            : `${x.expr} = ${x.equals}（差 ${x.diff || x.error || '不一致'}）`),
        });
      } catch {
        resolve({ allOk: true, note: '', failed: [] });
      }
    });
  });
}

async function correct(spec, failures, config) {
  try {
    const raw = await ai.askDeepSeek(
      `下面解题卡的符号验算失败：\n${failures.join('\n')}\n\n请修正错误并输出完整解题卡 JSON（结构同前，保留 checks）。\n${JSON.stringify(spec)}`,
      config, SOLVE_SYSTEM, 0, { json: true });
    const s = extractJson(raw);
    return isSpec(s) ? normalizeSpec(s) : spec;
  } catch {
    return spec;
  }
}

async function verify(spec, config) {
  try {
    const vcfg = config.verifyModel ? { ...config, model: config.verifyModel } : config;
    const raw = await ai.askDeepSeek(
      `${VERIFY_SYSTEM}\n\n解题卡：\n${JSON.stringify(spec)}`, config, VERIFY_SYSTEM, 0, { json: true });
    const v = extractJson(raw);
    if (!v) return { spec, issues: [] };
    if (v.corrected && isSpec(v.corrected)) return { spec: normalizeSpec(v.corrected), issues: v.issues || [] };
    return { spec, issues: v.issues || [] };
  } catch (_) {
    return { spec, issues: [] };
  }
}

function renderHtml(spec, issues = [], checkNote = '', originalImage = '') {
  const safeSpec = JSON.stringify(spec).replace(/</g, '\\u003c');
  const safeIssues = JSON.stringify(issues).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100%; background: #FFFBF2; color: #2E2419; }
  body { font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; }
  .wrap { display: grid; grid-template-columns: 46% 54%; min-height: 100vh; }
  .stage { padding: 40px 24px 40px 40px; display: flex; flex-direction: column; justify-content: center; }
  .stage-box { background: #FFF6E2; border: 1.5px solid rgba(58,42,26,.12); border-radius: 20px; padding: 22px; min-height: 420px; display: flex; align-items: center; justify-content: center; }
  .stage svg { width: 100%; height: auto; max-height: 420px; }
  .panel { padding: 40px 44px 40px 20px; display: flex; flex-direction: column; justify-content: center; }
  .kicker { font-size: 13px; letter-spacing: 3px; color: #C08A17; margin-bottom: 10px; }
  h1 { font-size: 30px; line-height: 1.3; margin-bottom: 16px; }
  .question { font-size: 13px; color: #8A7860; line-height: 1.6; margin-bottom: 12px; }
  .intuition { font-size: 14px; line-height: 1.6; color: #2E2419; background: #FFF0C8; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
  .analogy { font-size: 13px; line-height: 1.6; color: #8A5A00; margin-bottom: 14px; }
  .card { background: #FFFDF8; border: 1.5px solid rgba(58,42,26,.12); border-radius: 16px; padding: 20px 22px; min-height: 220px; box-shadow: 0 2px 0 rgba(58,42,26,.06); }
  .card h2 { font-size: 20px; margin-bottom: 10px; }
  .card p { font-size: 15px; line-height: 1.8; }
  .formula { margin-top: 14px; padding: 10px 14px; background: #FFF0C8; border-radius: 10px; font-family: Consolas, monospace; font-size: 15px; }
  .answer { margin-top: 14px; font-size: 17px; font-weight: 700; color: #A96F00; }
  .nav { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
  .nav button { border: 1.5px solid rgba(58,42,26,.16); background: #FFFDF8; border-radius: 999px; padding: 7px 14px; font-size: 13px; font-family: inherit; cursor: pointer; color: #2E2419; }
  .nav button.primary { background: #FFC93C; border-color: #E8A20A; font-weight: 700; box-shadow: 0 2px 0 #E8A20A; }
  .nav button:disabled { opacity: .45; cursor: default; }
  .dots { flex: 1; display: flex; gap: 6px; justify-content: center; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(58,42,26,.18); transition: background .2s, transform .2s; cursor: pointer; }
  .dot.on { background: #E8A20A; transform: scale(1.35); }
  .pitfalls { margin-top: 16px; font-size: 12.5px; color: #8A7860; line-height: 1.7; }
  .pitfalls b { color: #B4543A; }
  .warn { margin-top: 10px; font-size: 12px; color: #B4543A; }
  .ok { margin-top: 10px; font-size: 12px; color: #2E7D32; }
  .fade { animation: fade .28s ease; }
  @keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .draw { stroke-dasharray: 600; stroke-dashoffset: 600; animation: draw .9s ease forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @media (max-width: 820px) { .wrap { grid-template-columns: 1fr; } .stage { padding: 20px; } .panel { padding: 8px 20px 30px; } }
</style></head>
<body>
<div class="wrap">
  <div class="stage"><div class="stage-box" id="diagram"></div></div>
  <div class="panel">
    <div class="kicker" id="kicker"></div>
    <h1 id="title"></h1>
    <div class="question" id="question"></div>
    <div class="intuition" id="intuition"></div>
    <div class="analogy" id="analogy"></div>
    <div class="card" id="card">
      <h2 id="step-title"></h2>
      <p id="step-body"></p>
      <div class="formula" id="step-formula"></div>
      <div class="answer" id="answer"></div>
    </div>
    <div class="nav">
      <button id="prev">← 上一步</button>
      <div class="dots" id="dots"></div>
      <button id="next" class="primary">下一步 →</button>
    </div>
    <div class="pitfalls" id="pitfalls"></div>
    <div class="ok" id="checknote"></div>
    <div class="warn" id="warn"></div>
  </div>
</div>
<script>
  const SPEC = ${safeSpec};
  const ISSUES = ${safeIssues};
  const ORIGINAL = ${safeOriginal};
  const steps = SPEC.steps.slice();
  if (SPEC.answer) steps.push({ title: '答案', body: SPEC.checkpoint || '对照上面的推导，自己再复述一遍。', formula: '', visual: { type: 'none' }, answer: SPEC.answer });
  let i = 0;
  let timer = null;
  const el = (id) => document.getElementById(id);

  el('kicker').textContent = SPEC.subject;
  el('title').textContent = SPEC.title;
  el('question').textContent = SPEC.question;
  el('intuition').textContent = SPEC.intuition ? '💡 一句话直觉：' + SPEC.intuition : '';
  el('intuition').style.display = SPEC.intuition ? 'block' : 'none';
  el('analogy').textContent = SPEC.analogy ? '🧸 打个比方：' + SPEC.analogy : '';
  el('analogy').style.display = SPEC.analogy ? 'block' : 'none';
  el('pitfalls').innerHTML = (SPEC.pitfalls && SPEC.pitfalls.length)
    ? '<b>易错点：</b>' + SPEC.pitfalls.map((p) => '　• ' + p).join('<br>') : '';
  if (ISSUES && ISSUES.length) el('warn').textContent = '校验提示：' + ISSUES.join('；');
  el('checknote').textContent = ${JSON.stringify(checkNote)};

  function svgTriangle(d) {
    const a = d.aLabel || d.a || 'a', b = d.bLabel || d.b || 'b', c = d.cLabel || d.c || 'c';
    return '<svg viewBox="0 0 460 340">' +
      '<polygon points="60,290 60,70 400,290" fill="rgba(255,201,60,.2)" stroke="#3A2A1A" stroke-width="3" class="draw"/>' +
      '<rect x="60" y="270" width="20" height="20" fill="none" stroke="#3A2A1A" stroke-width="2"/>' +
      '<text x="28" y="190" font-size="20" fill="#3B6EA5">' + b + '</text>' +
      '<text x="220" y="325" font-size="20" fill="#C08A17">' + a + '</text>' +
      '<text x="250" y="165" font-size="20" fill="#3A2A1A">' + c + '</text>' +
      '</svg>';
  }
  function svgAxes(d) {
    const pts = (d.points || []).slice(0, 8);
    let s = '<svg viewBox="0 0 460 340">' +
      '<line x1="50" y1="290" x2="430" y2="290" stroke="#3A2A1A" stroke-width="2"/>' +
      '<line x1="70" y1="40" x2="70" y2="300" stroke="#3A2A1A" stroke-width="2"/>';
    const cv = d.curve || null;
    if (cv && cv.type === 'parabola') {
      const a = Number(cv.a) || 1, b = Number(cv.b) || 0, c = Number(cv.c) || 0;
      let path = '';
      for (let k = 0; k <= 60; k++) {
        const x = -4 + (8 * k) / 60;
        const y = a * x * x + b * x + c;
        const px = 70 + ((x + 4) / 8) * 340;
        const py = 290 - (y + 5) * 20;
        path += (k ? 'L' : 'M') + px.toFixed(1) + ',' + Math.max(20, Math.min(300, py)).toFixed(1);
      }
      s += '<path d="' + path + '" fill="none" stroke="#3B6EA5" stroke-width="3" class="draw"/>';
    } else if (cv && cv.type === 'line') {
      const a = Number(cv.a) || 1, b = Number(cv.b) || 0;
      s += '<line x1="70" y1="' + (290 - b * 20) + '" x2="410" y2="' + (290 - (a * 4 + b) * 20) + '" stroke="#3B6EA5" stroke-width="3" class="draw"/>';
    }
    pts.forEach((p) => {
      const px = 70 + ((Number(p.x) + 4) / 8) * 340;
      const py = Math.max(20, Math.min(300, 290 - (Number(p.y) + 5) * 20));
      s += '<circle cx="' + px + '" cy="' + py + '" r="5" fill="#E8A20A"/>';
      if (p.label) s += '<text x="' + (px + 8) + '" y="' + (py - 8) + '" font-size="16" fill="#3A2A1A">' + p.label + '</text>';
    });
    return s + '</svg>';
  }
  function svgCircle(d) {
    const cx = 230, cy = 170, r = 118;
    let s = '<svg viewBox="0 0 460 340">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="rgba(255,201,60,.18)" stroke="#3A2A1A" stroke-width="3" class="draw"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="#3A2A1A"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + r) + '" y2="' + cy + '" stroke="#3B6EA5" stroke-width="2"/>' +
      '<text x="' + (cx + r / 2 - 8) + '" y="' + (cy - 10) + '" font-size="18" fill="#3B6EA5">' + (d.label || 'r') + '</text>';
    if (d.angle) {
      s += '<path d="M ' + (cx + 40) + ' ' + cy + ' A 40 40 0 0 0 ' + (cx + 40 * Math.cos(-Number(d.angle) * Math.PI / 180)) + ' ' + (cy + 40 * Math.sin(-Number(d.angle) * Math.PI / 180)) + '" fill="none" stroke="#E8A20A" stroke-width="2"/>';
      s += '<text x="' + (cx + 46) + '" y="' + (cy - 30) + '" font-size="14" fill="#C08A17">' + d.angle + '°</text>';
    }
    return s + '</svg>';
  }
  function svgVectors(d) {
    const cx = 230, cy = 210;
    let s = '<svg viewBox="0 0 460 340">' +
      '<line x1="60" y1="' + cy + '" x2="400" y2="' + cy + '" stroke="rgba(58,42,26,.25)" stroke-dasharray="4 5"/>' +
      '<line x1="' + cx + '" y1="40" x2="' + cx + '" y2="300" stroke="rgba(58,42,26,.25)" stroke-dasharray="4 5"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#3A2A1A"/>';
    (d.vectors || []).slice(0, 6).forEach((v) => {
      const ang = Number(v.angle || 0) * Math.PI / 180;
      const len = Math.max(20, Math.min(150, Number(v.length) || 80));
      const x2 = cx + Math.cos(ang) * len;
      const y2 = cy - Math.sin(ang) * len;
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#3B6EA5" stroke-width="3" class="draw"/>';
      s += '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="4" fill="#3B6EA5"/>';
      if (v.label) s += '<text x="' + (x2 + 6).toFixed(1) + '" y="' + (y2 - 6).toFixed(1) + '" font-size="15" fill="#2E2419">' + v.label + '</text>';
    });
    return s + '</svg>';
  }
  function svgNumberline(d) {
    const min = Number(d.min), max = Number(d.max);
    const lo = Number.isFinite(min) ? min : -5, hi = Number.isFinite(max) ? max : 5;
    const span = hi - lo || 1;
    const x = (v) => 60 + ((Number(v) - lo) / span) * 340;
    let s = '<svg viewBox="0 0 460 340"><line x1="50" y1="170" x2="430" y2="170" stroke="#3A2A1A" stroke-width="2"/>' +
      '<text x="420" y="160" font-size="14" fill="#8A7860">→</text>';
    (d.marks || []).slice(0, 10).forEach((m) => {
      const px = x(m.x);
      s += '<line x1="' + px + '" y1="162" x2="' + px + '" y2="178" stroke="#3A2A1A" stroke-width="2"/>';
      s += '<circle cx="' + px + '" cy="170" r="4" fill="#E8A20A"/>';
      if (m.label != null) s += '<text x="' + (px - 6) + '" y="200" font-size="15" fill="#2E2419">' + m.label + '</text>';
    });
    return s + '</svg>';
  }
  function svgFlow(d) {
    const nodes = (d.nodes || []).slice(0, 5);
    let s = '<svg viewBox="0 0 460 340">';
    nodes.forEach((n, k) => {
      const y = 40 + k * 60;
      s += '<rect x="60" y="' + y + '" width="340" height="40" rx="10" fill="rgba(255,201,60,.22)" stroke="#3A2A1A" stroke-width="2" class="draw"/>';
      s += '<text x="80" y="' + (y + 26) + '" font-size="15" fill="#2E2419">' + n + '</text>';
      if (k < nodes.length - 1) s += '<line x1="230" y1="' + (y + 40) + '" x2="230" y2="' + (y + 60) + '" stroke="#3A2A1A" stroke-width="2"/>';
    });
    return s + '</svg>';
  }
  function renderDiagram(v) {
    const box = el('diagram');
    const type = (v && v.type) || 'none';
    let html = '';
    if (type === 'triangle') html = svgTriangle(v.data || {});
    else if (type === 'axes') html = svgAxes(v.data || {});
    else if (type === 'flow') html = svgFlow(v.data || {});
    else if (type === 'circle') html = svgCircle(v.data || {});
    else if (type === 'numberline') html = svgNumberline(v.data || {});
    else if (type === 'vectors') html = svgVectors(v.data || {});
    if (!html && ORIGINAL) {
      html = '<div style="text-align:center">' +
        '<img src="' + ORIGINAL + '" style="max-width:100%;max-height:400px;border-radius:12px;box-shadow:0 4px 16px rgba(58,42,26,.12)">' +
        '<div style="font-size:12px;color:#8A7860;margin-top:10px">原题图</div></div>';
    }
    if (!html) {
      const st = steps[i] || {};
      html = '<div style="font-size:22px;line-height:1.7;text-align:center;padding:20px">' +
        (st.formula || st.title || '') + '</div>';
    }
    box.innerHTML = html;
    box.classList.remove('fade'); void box.offsetWidth; box.classList.add('fade');
  }
  function show(n) {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const st = steps[i];
    el('step-title').textContent = st.title || '';
    el('step-body').textContent = st.body || '';
    el('step-formula').textContent = st.formula || '';
    el('step-formula').style.display = st.formula ? 'block' : 'none';
    el('answer').textContent = st.answer ? '答案：' + st.answer : '';
    el('answer').style.display = st.answer ? 'block' : 'none';
    el('prev').disabled = i === 0;
    el('next').textContent = i === steps.length - 1 ? '重来 ↺' : '下一步 →';
    const dots = el('dots'); dots.innerHTML = '';
    steps.forEach((_, k) => {
      const d = document.createElement('span');
      d.className = 'dot' + (k === i ? ' on' : '');
      d.onclick = () => { stop(); show(k); };
      dots.appendChild(d);
    });
    renderDiagram(st.visual);
    el('card').classList.remove('fade'); void el('card').offsetWidth; el('card').classList.add('fade');
    if (i === steps.length - 1) stop();
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function start() { stop(); timer = setInterval(() => { if (i >= steps.length - 1) { stop(); return; } show(i + 1); }, 6000); }
  el('prev').onclick = () => { stop(); show(i - 1); };
  el('next').onclick = () => { stop(); if (i >= steps.length - 1) show(0); else show(i + 1); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { stop(); show(i + 1); }
    if (e.key === 'ArrowLeft') { stop(); show(i - 1); }
  });
  show(0);
  start();
</script>
</body></html>`;
}

function normAnswer(a) {
  return String(a || '').toLowerCase().replace(/[\s，。,.：:；;、"'"'（）()=]/g, '');
}

async function arbitrate(a, b, config) {
  try {
    const vcfg = config.verifyModel ? { ...config, model: config.verifyModel } : config;
    const raw = await ai.askDeepSeek(
      `两位老师独立解题，得到了不同的答案。请以阅卷老师的标准判断哪一版正确，并输出修正后的完整解题卡 JSON（结构同前）。

A：${JSON.stringify(a)}

B：${JSON.stringify(b)}`,
      vcfg, SOLVE_SYSTEM, 0, { json: true });
    const s = extractJson(raw);
    return isSpec(s) ? normalizeSpec(s) : null;
  } catch (_) {
    return null;
  }
}

const CACHE_VERSION = 'v2';
const CACHE_TTL = 30 * 24 * 3600 * 1000;

function cacheKey(q, config, imagePath) {
  const h = crypto.createHash('sha256');
  h.update(CACHE_VERSION + '|' + String(config.model || '') + '|' + String(config.verifyModel || '') + '|' + String(q).replace(/\s+/g, ' ').trim().toLowerCase());
  if (imagePath) {
    try { h.update(fs.readFileSync(imagePath)); } catch (_) {}
  }
  return h.digest('hex');
}

function readCache(dir, key) {
  try {
    const file = path.join(dir, key + '.json');
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !data.spec || !data.ts) return null;
    if (Date.now() - data.ts > CACHE_TTL) { fs.rmSync(file, { force: true }); return null; }
    return data;
  } catch (_) {
    return null;
  }
}

function writeCache(dir, key, payload) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({ ...payload, ts: Date.now() }));
  } catch (_) {}
}

function findCachedSpec(topic, config, imagePath, cacheDir) {
  if (!cacheDir) return null;
  try {
    const hit = readCache(cacheDir, cacheKey(String(topic || ''), config, imagePath));
    return hit && hit.spec ? hit.spec : null;
  } catch (_) {
    return null;
  }
}

async function generate(topic, config, imagePath, opts = {}) {
  const q = String(topic || '').trim();
  if (!q && !imagePath) throw new Error('请提供知识点、题目或图片');
  const emit = (pct, msg) => { try { if (opts.onProgress) opts.onProgress({ pct, msg }); } catch (_) {} };
  const promptText = q || '请先识别图片中的题目并解答';
  emit(5, '解题中…');
  const key = cacheKey(promptText, config, imagePath);
  if (opts.cacheDir) {
    const hit = readCache(opts.cacheDir, key);
    if (hit) {
      emit(100, '命中缓存');
      return renderHtml(hit.spec, hit.issues || [], (hit.note || '') + ' · 命中缓存', imagePath ? imageData(imagePath) : '');
    }
  }
  let spec = augmentChecks(await solve(promptText, config, imagePath));
  emit(35, '解题完成，开始校验…');
  let dualNote = '';
  // 双解一致性：只在纯文本题上做，避免图片题第二次看不到图
  if (!imagePath && promptText.length >= 6) {
    try {
      const second = augmentChecks(await solve(promptText + '\n（请独立再解一遍，不要参考上一次）', config, null, 0.7));
      if (normAnswer(second.answer) && normAnswer(spec.answer) && normAnswer(second.answer) === normAnswer(spec.answer)) {
        dualNote = '双解一致';
      } else if (normAnswer(spec.answer) && normAnswer(second.answer)) {
        const fixed = await arbitrate(spec, second, config);
        if (fixed) { spec = augmentChecks(fixed); dualNote = '双解不一致，已仲裁修正'; }
      }
    } catch (_) {}
  }
  emit(55, '符号验算中…');
  const check = await runChecks(spec.checks, opts.sympyScript, opts.python);
  let extra = [];
  if (!check.allOk) {
    extra = ['符号验算未通过：' + check.failed.join('；')];
    spec = await correct(spec, check.failed, config);
    const recheck = await runChecks(spec.checks, opts.sympyScript, opts.python);
    if (recheck.allOk) extra = [];
    else if (recheck.failed.length) extra = ['符号验算仍有未通过项：' + recheck.failed.join('；')];
  }
  emit(80, '阅卷校验中…');
  const verified = await verify(spec, config);
  emit(95, '渲染讲解页…');
  const note = [check.note, dualNote].filter(Boolean).join(' · ');
  const issues = [...(verified.issues || []), ...extra];
  if (issues.length && typeof opts.onIssues === 'function') {
    try { opts.onIssues({ question: promptText, issues, spec: verified.spec }); } catch (_) {}
  }
  if (opts.cacheDir) writeCache(opts.cacheDir, key, { spec: verified.spec, issues, note });
  return renderHtml(verified.spec, issues, note, imagePath ? imageData(imagePath) : '');
}

module.exports = { generate, solve, verify, renderHtml, findCachedSpec };
