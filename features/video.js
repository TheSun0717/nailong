// 教学视频流水线：分镜脚本 → 画面 → 配音 → 合成 MP4
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BrowserWindow } = require('electron');
const ai = require('../ai');

const TTS_URL = process.env.NAILONG_TTS_URL || 'http://127.0.0.1:3900';
const FPS = 15;

const STORY_SYSTEM = `你是教学视频编剧。把用户给的知识点或题目拆成 5 到 7 个镜头，只输出 JSON，不要代码围栏。

JSON 结构：
{"title":"视频标题","subject":"学科","scenes":[{"title":"镜头标题","bullets":["要点1","要点2"],"narration":"这一镜的旁白","visual":{"type":"triangle|axes|flow|none","data":{}}}]}

要求：
- 第 1 镜引入问题并说明「学完你会什么」，最后 1 镜总结。
- 每个镜头 2 到 4 条 bullet，每条不超过 20 个汉字。
- narration 是可直接朗读的口语中文，40 到 90 字；假设听众是小学生，多用生活比喻，少用术语（术语第一次出现要用大白话解释）；不要出现 Markdown、序号、括号符号、公式符号；数学表达式用中文念法。
- 内容要准确、具体，不写空话。
- visual 不能全部是 none：至少 3 个镜头必须有图示；数学/几何题优先 triangle/axes，物理受力用 vectors，步骤类用 flow；triangle 的 data 用 a/b/c/aLabel/bLabel/cLabel，axes 用 points 数组，flow 用 nodes 数组。
- 只输出 JSON。`;

function extractJson(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 语音服务没开时尝试拉起 VoiceStudio（只在本机存在该路径时）
async function ensureTts() {
  if (await ttsReady()) return true;
  const exe = process.env.NAILONG_VOICESTUDIO || 'D:/VoiceStudio/VoiceStudio.exe';
  try {
    if (fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if (await ttsReady()) return true;
  }
  return false;
}

async function ttsReady() {
  try {
    const r = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    return j.status === 'ok';
  } catch {
    return false;
  }
}

async function synthesize(text, outFile) {
  const res = await fetch(`${TTS_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'omnivoice', input: text, voice: 'default', response_format: 'wav' }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`语音合成失败（${res.status}）`);
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
  return outFile;
}

function audioDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(parseFloat(out) || 0));
    p.on('error', () => resolve(0));
  });
}

async function storyboard(topic, config, verifiedSpec) {
  const extra = verifiedSpec
    ? `

【已校验的解题卡】请严格使用下面的步骤与答案，不要重新求解：
${JSON.stringify({ title: verifiedSpec.title, steps: verifiedSpec.steps, answer: verifiedSpec.answer })}`
    : '';
  const raw = await ai.askDeepSeek(String(topic || '').trim() + extra, config, STORY_SYSTEM, 0.6);
  const data = extractJson(raw);
  if (!data || !Array.isArray(data.scenes) || !data.scenes.length) {
    throw new Error('分镜脚本没生成成功，再试一次');
  }
  const scenes = data.scenes.slice(0, 7).map((s, i) => ({
    title: String(s.title || `第 ${i + 1} 部分`).slice(0, 60),
    bullets: (Array.isArray(s.bullets) ? s.bullets : []).slice(0, 4).map((b) => String(b).slice(0, 40)),
    narration: String(s.narration || s.title || '').slice(0, 500),
  })).filter((s) => s.narration || s.bullets.length);
  if (!scenes.length) throw new Error('分镜脚本是空的');
  return { title: String(data.title || topic).slice(0, 80), subject: String(data.subject || '知识点'), scenes };
}

// 用已验证解题卡直接生成分镜：真实图示、0 额外模型调用
function scenesFromSpec(spec) {
  const scenes = [];
  let firstVisual = (spec.steps && spec.steps[0] && spec.steps[0].visual) || { type: 'none' };
  if ((!firstVisual || firstVisual.type === 'none') && spec.intuition) {
    firstVisual = { type: 'spotlight', data: { title: '一句话直觉', text: spec.intuition } };
  }
  scenes.push({
    title: spec.title || '讲解',
    bullets: [spec.intuition || spec.question || ''].filter(Boolean).slice(0, 2),
    narration: [spec.intuition, spec.analogy].filter(Boolean).join('。') || spec.question || spec.title || '',
    visual: firstVisual,
  });
  (spec.steps || []).slice(0, 6).forEach((st, i) => {
    const sentences = String(st.body || '').split(/[。；;!?！？]/).map((x) => x.trim()).filter(Boolean);
    const bullets = [st.title, ...sentences].filter(Boolean).slice(0, 3).map((x) => String(x).slice(0, 24));
    let vis = st.visual || { type: 'none' };
    // 同一动效不当两次主角：开场已经是 spotlight，第一步就不再重复
    if (i === 0 && vis.type === 'spotlight' && firstVisual.type === 'spotlight') vis = { type: 'none' };
    scenes.push({
      title: st.title || '步骤',
      bullets,
      narration: [st.title, st.body].filter(Boolean).join('。').slice(0, 400),
      visual: vis,
    });
  });
  if (spec.answer) {
    scenes.push({
      title: '答案',
      bullets: [String(spec.answer).slice(0, 24)],
      narration: `所以答案是 ${spec.answer}。${spec.checkpoint || ''}`,
      visual: {
        type: 'formula',
        data: { lines: [String(spec.answer)], highlight: 0, note: spec.checkpoint || '' },
        camera: { from: 1, to: 1.03 },
      },
    });
  }
  return scenes.slice(0, 8);
}

function svgForVisual(v) {
  const type = (v && v.type) || 'none';
  const d = (v && v.data) || {};
  if (type === 'triangle') {
    const a = d.aLabel || d.a || 'a', b = d.bLabel || d.b || 'b', c = d.cLabel || d.c || 'c';
    return '<svg viewBox="0 0 460 340">' +
      '<polygon class="draw" points="60,290 60,70 400,290" fill="rgba(255,201,60,.2)" stroke="#3A2A1A" stroke-width="3"/>' +
      '<rect x="60" y="270" width="20" height="20" fill="none" stroke="#3A2A1A" stroke-width="2"/>' +
      '<text x="28" y="190" font-size="20" fill="#3B6EA5">' + esc(b) + '</text>' +
      '<text x="220" y="325" font-size="20" fill="#C08A17">' + esc(a) + '</text>' +
      '<text x="250" y="165" font-size="20" fill="#3A2A1A">' + esc(c) + '</text></svg>';
  }
  if (type === 'axes') {
    let s = '<svg viewBox="0 0 460 340"><line x1="50" y1="290" x2="430" y2="290" stroke="#3A2A1A" stroke-width="2"/><line x1="70" y1="40" x2="70" y2="300" stroke="#3A2A1A" stroke-width="2"/>';
    const cv = d.curve;
    if (cv && cv.type === 'parabola') {
      const a = Number(cv.a) || 1, b = Number(cv.b) || 0, c = Number(cv.c) || 0;
      let path = '';
      for (let k = 0; k <= 60; k++) {
        const x = -4 + (8 * k) / 60;
        const y = a * x * x + b * x + c;
        path += (k ? 'L' : 'M') + (70 + ((x + 4) / 8) * 340).toFixed(1) + ',' + Math.max(20, Math.min(300, 290 - (y + 5) * 20)).toFixed(1);
      }
      s += '<path class="draw" d="' + path + '" fill="none" stroke="#3B6EA5" stroke-width="3"/>';
    }
    (d.points || []).slice(0, 8).forEach((p) => {
      const px = 70 + ((Number(p.x) + 4) / 8) * 340;
      const py = Math.max(20, Math.min(300, 290 - (Number(p.y) + 5) * 20));
      s += '<circle cx="' + px + '" cy="' + py + '" r="5" fill="#E8A20A"/>';
      if (p.label) s += '<text x="' + (px + 8) + '" y="' + (py - 8) + '" font-size="16">' + esc(p.label) + '</text>';
    });
    return s + '</svg>';
  }
  if (type === 'vectors') {
    const cx = 230, cy = 210;
    let s = '<svg viewBox="0 0 460 340">' +
      '<line x1="60" y1="' + cy + '" x2="400" y2="' + cy + '" stroke="rgba(58,42,26,.25)" stroke-dasharray="4 5"/>' +
      '<line x1="' + cx + '" y1="40" x2="' + cx + '" y2="300" stroke="rgba(58,42,26,.25)" stroke-dasharray="4 5"/>';
    (d.vectors || []).slice(0, 6).forEach((v) => {
      const ang = Number(v.angle || 0) * Math.PI / 180;
      const len = Math.max(20, Math.min(150, Number(v.length) || 80));
      const x2 = cx + Math.cos(ang) * len;
      const y2 = cy - Math.sin(ang) * len;
      s += '<line class="draw" x1="' + cx + '" y1="' + cy + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#3B6EA5" stroke-width="3"/>';
      if (v.label) s += '<text x="' + (x2 + 6).toFixed(1) + '" y="' + (y2 - 6).toFixed(1) + '" font-size="15">' + esc(v.label) + '</text>';
    });
    return s + '</svg>';
  }
  if (type === 'flow') {
    const nodes = (d.nodes || []).slice(0, 5);
    let s = '<svg viewBox="0 0 460 340">';
    nodes.forEach((n, k) => {
      const y = 40 + k * 60;
      s += '<rect class="draw" x="60" y="' + y + '" width="340" height="40" rx="10" fill="rgba(255,201,60,.22)" stroke="#3A2A1A" stroke-width="2"/>';
      s += '<text x="80" y="' + (y + 26) + '" font-size="15">' + esc(n) + '</text>';
      if (k < nodes.length - 1) s += '<line x1="230" y1="' + (y + 40) + '" x2="230" y2="' + (y + 60) + '" stroke="#3A2A1A" stroke-width="2"/>';
    });
    return s + '</svg>';
  }
  return '';
}

// 镜头词汇表：formula/board/spotlight/compare 是 2.1 新增的语义镜头（借鉴 Manim / video-shotcraft）
const KNOWN_TYPES = new Set(['triangle', 'axes', 'vectors', 'flow', 'circle', 'numberline', 'formula', 'board', 'spotlight', 'compare', 'none']);

// 上标小美化：x^2 → x²（只影响画面，不影响旁白读音）
function prettyMath(text) {
  return String(text ?? '')
    .replace(/\^2/g, '²')
    .replace(/\^3/g, '³')
    .replace(/\^\(-1\)/g, '⁻¹')
    .replace(/\^\(1\/2\)/g, '½');
}

function visualHtml(v) {
  const type = (v && v.type) || 'none';
  const d = (v && v.data) || {};
  if (type === 'formula') {
    const lines = (Array.isArray(d.lines) ? d.lines : []).slice(0, 4);
    const hl = Number.isFinite(d.highlight) ? d.highlight : lines.length - 1;
    return '<div class="v-formula">' + lines.map((l, i) =>
      `<div class="fl${i === hl ? ' hl' : ''}">${esc(prettyMath(l))}</div>`).join('') +
      (d.note ? `<div class="f-note">${esc(prettyMath(d.note))}</div>` : '') + '</div>';
  }
  if (type === 'board') {
    const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 5);
    return '<div class="v-board">' + steps.map((s, i) =>
      `<div class="bs${i === d.underline ? ' ul' : ''}">${esc(prettyMath(s))}</div>`).join('') + '</div>';
  }
  if (type === 'spotlight') {
    return '<div class="v-spot"><div class="sp-glow"></div><div class="sp-card">' +
      `<div class="sp-title">${esc(d.title || '一句话直觉')}</div><div class="sp-text">${esc(prettyMath(d.text || ''))}</div></div></div>`;
  }
  if (type === 'compare') {
    const L = d.left || {};
    const R = d.right || {};
    return '<div class="v-cmp">' +
      `<div class="cmp cl"><b>${esc(L.title || '错解')}</b><span>${esc(prettyMath(L.text || ''))}</span></div>` +
      `<div class="cmp cr"><b>${esc(R.title || '正解')}</b><span>${esc(prettyMath(R.text || ''))}</span></div>` +
      '</div>';
  }
  return svgForVisual(v);
}

// 渲染前 lint：空旁白、超长文案、缺图示、未知镜头
function lintSpec(scenes) {
  const issues = [];
  if (!Array.isArray(scenes) || !scenes.length) return ['没有镜头'];
  scenes.forEach((s, i) => {
    const n = String(s.narration || '').trim();
    if (!n) issues.push(`第 ${i + 1} 镜没有旁白`);
    if (n.length > 140) issues.push(`第 ${i + 1} 镜旁白过长（${n.length} 字）`);
    (s.bullets || []).forEach((b) => {
      if (String(b).length > 28) issues.push(`第 ${i + 1} 镜 bullet 超长：${String(b).slice(0, 12)}…`);
    });
    const t = (s.visual && s.visual.type) || 'none';
    // 没有显式图示时，渲染层会用流程图标兜底（需要至少两条要点）
    if (t === 'none' && (s.bullets || []).length < 2) issues.push(`第 ${i + 1} 镜没有图示`);
    if (!KNOWN_TYPES.has(t)) issues.push(`第 ${i + 1} 镜未知镜头类型：${t}`);
  });
  if (scenes.length > 9) issues.push(`镜头数 ${scenes.length} 偏多，建议 ≤9`);
  return issues;
}

function splitSentences(text) {
  return String(text || '')
    .split(/[。！？；!?;]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 6);
}

function buildHtml(data, timeline, totalMs) {
  const scenesHtml = data.scenes.map((s, i) => `
    <section class="scene${i === 0 ? ' active' : ''}">
      <div class="kicker">${esc(data.subject)}</div>
      <h1>${esc(s.title)}</h1>
      <div class="cols">
        <div class="txt"><ul>${s.bullets.map((b) => `<li><span class="dot"></span><span>${esc(b)}</span></li>`).join('')}</ul></div>
        ${(() => {
          let html = visualHtml(s.visual);
          if (!html && s.bullets && s.bullets.length >= 2) html = visualHtml({ type: 'flow', data: { nodes: s.bullets } });
          return html ? `<div class="vis">${html}</div>` : '';
        })()}
      </div>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 720px; overflow: hidden; background: #FFFBF2; }
  body { font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; color: #2E2419; }
  .bg { position: absolute; inset: 0; background: radial-gradient(rgba(58,42,26,.05) 1px, transparent 1px) 0 0 / 22px 22px; }
  .brand { position: absolute; left: 84px; top: 56px; font-size: 18px; letter-spacing: 2px; color: #B6A78E; }
  .counter { position: absolute; right: 84px; top: 56px; font-size: 18px; letter-spacing: 2px; color: #B6A78E; }
  .scene { position: absolute; inset: 0; padding: 96px 84px 150px; display: flex; flex-direction: column; justify-content: center; }
  .kicker { font-size: 20px; letter-spacing: 3px; color: #C08A17; margin-bottom: 16px; }
  h1 { font-size: 50px; line-height: 1.24; margin-bottom: 30px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 16px; }
  li { font-size: 28px; line-height: 1.5; display: flex; gap: 14px; align-items: flex-start; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #F2A81D; margin-top: 15px; flex: 0 0 auto; }
  .cols { display: flex; gap: 34px; align-items: center; }
  .cols .txt { flex: 1; min-width: 0; }
  .vis { flex: 0 0 40%; max-width: 420px; }
  .vis svg { width: 100%; height: auto; max-height: 300px; }
  .scene.on .vis .draw { stroke-dasharray: 700; stroke-dashoffset: 700; animation: draw 1.1s ease forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .sub { position: absolute; left: 84px; right: 84px; bottom: 58px; font-size: 20px; line-height: 1.55; color: #8A7860; }
  .bar { position: absolute; left: 0; bottom: 0; height: 6px; width: 0; background: #F2A81D; }
  /* 2.1 语义镜头 */
  .v-formula, .v-board { display: flex; flex-direction: column; gap: 16px; font-family: Consolas, "Cascadia Mono", monospace;
    font-size: 30px; color: #2E2419; }
  .fl, .bs { padding: 6px 12px; border-left: 3px solid transparent; transition: none; }
  .fl.hl { background: rgba(242,168,29,.16); border-left-color: #F2A81D; border-radius: 6px; }
  .f-note { font-family: "Microsoft YaHei UI", sans-serif; font-size: 18px; color: #C08A17; margin-top: 4px; }
  .bs.ul { border-bottom: 3px solid #F2A81D; display: inline-block; padding-bottom: 4px; }
  .v-spot { position: relative; width: 100%; height: 300px; display: flex; align-items: center; justify-content: center; }
  .sp-glow { position: absolute; width: 360px; height: 360px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,201,60,.55), rgba(255,201,60,0) 70%); }
  .sp-card { position: relative; width: 100%; padding: 26px 24px; border-radius: 20px; background: #FFFDF7;
    box-shadow: 0 14px 32px rgba(120,90,40,.16); border: 1px solid rgba(58,42,26,.08); }
  .sp-title { font-size: 18px; letter-spacing: 2px; color: #C08A17; margin-bottom: 12px; }
  .sp-text { font-size: 24px; line-height: 1.5; }
  .v-cmp { display: flex; gap: 14px; width: 100%; }
  .cmp { flex: 1; padding: 20px 16px; border-radius: 16px; display: flex; flex-direction: column; gap: 12px;
    font-size: 22px; line-height: 1.4; background: rgba(58,42,26,.05); }
  .cmp b { font-size: 16px; letter-spacing: 1px; color: #B6A78E; }
  .cmp.cr { background: rgba(255,201,60,.22); }
  .cmp.cr b { color: #C08A17; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="brand">奶龙讲解</div>
  <div class="counter" id="counter"></div>
  <div id="scenes">${scenesHtml}</div>
  <p class="sub" id="sub"></p>
  <div class="bar" id="bar"></div>
<script>
  const TIMELINE = ${JSON.stringify(timeline)};
  const TOTAL = ${totalMs};
  const SUBS = ${JSON.stringify(data.scenes.map((s) => splitSentences(s.narration)))};
  const CAMERAS = ${JSON.stringify(data.scenes.map((s) => (s.visual && s.visual.camera) || null))};
  const scenes = Array.from(document.querySelectorAll('.scene'));
  const titles = scenes.map((s) => s.querySelector('h1'));
  const bullets = scenes.map((s) => Array.from(s.querySelectorAll('li')));
  const subEl = document.getElementById('sub');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  window.__renderAt = function (ms) {
    let idx = TIMELINE.length - 1;
    for (let i = 0; i < TIMELINE.length; i++) { if (ms < TIMELINE[i].end) { idx = i; break; } }
    const st = TIMELINE[idx];
    const local = ms - st.start;
    const enter = clamp(local / 600, 0, 1);
    const exit = clamp((st.end - ms) / 500, 0, 1);
    const op = Math.min(enter, exit);
    scenes.forEach((el, i) => {
      el.classList.toggle('on', i === idx);
      el.style.visibility = i === idx ? 'visible' : 'hidden';
      el.style.opacity = i === idx ? op : '0';
      el.style.transform = i === idx ? 'scale(' + (1.03 - 0.03 * enter) + ')' : 'scale(1)';
      el.style.transformOrigin = 'center center';
    });
    const dur = Math.max(1, st.end - st.start);
    const pr = clamp(local / dur, 0, 1);
    const vis = scenes[idx].querySelector('.vis');
    if (vis) {
      const cam = CAMERAS[idx] || { from: 1, to: 1.03 };
      const sc = (cam.from || 1) + ((cam.to || 1) - (cam.from || 1)) * pr;
      vis.style.transform = 'translate(' + ((cam.panX || 0) * pr) + 'px,' + ((cam.panY || 0) * pr) + 'px) scale(' + sc + ')';
    }
    // formula：行依次写出，旧行变淡，高亮行最后强调
    scenes[idx].querySelectorAll('.fl').forEach((el, i) => {
      const p = clamp((local - 420 - i * 550) / 420, 0, 1);
      el.style.opacity = p * (el.classList.contains('hl') ? 1 : 0.55);
      el.style.transform = 'translateX(' + (1 - p) * -16 + 'px)';
    });
    // board：板书逐条出现
    scenes[idx].querySelectorAll('.bs').forEach((el, i) => {
      const p = clamp((local - 420 - i * 620) / 450, 0, 1);
      el.style.opacity = p;
      el.style.transform = 'translateY(' + (1 - p) * 10 + 'px)';
    });
    // spotlight：卡片弹入，光斑缓慢呼吸
    const sp = scenes[idx].querySelector('.sp-card');
    if (sp) {
      const p = clamp((local - 350) / 650, 0, 1);
      sp.style.opacity = p;
      sp.style.transform = 'scale(' + (0.92 + 0.08 * p) + ')';
      const glow = scenes[idx].querySelector('.sp-glow');
      if (glow) glow.style.opacity = 0.5 + 0.5 * Math.sin(local / 420);
    }
    // compare：左栏先亮，右栏随后
    const cl = scenes[idx].querySelector('.cmp.cl');
    const cr = scenes[idx].querySelector('.cmp.cr');
    if (cl) { const p = clamp((local - 400) / 500, 0, 1); cl.style.opacity = p; cl.style.transform = 'translateY(' + (1 - p) * 14 + 'px)'; }
    if (cr) { const p = clamp((local - 1100) / 500, 0, 1); cr.style.opacity = p; cr.style.transform = 'translateY(' + (1 - p) * 14 + 'px)'; }
    const p1 = clamp(local / 700, 0, 1);
    titles[idx].style.opacity = p1;
    titles[idx].style.transform = 'translateY(' + (1 - p1) * 20 + 'px)';
    bullets[idx].forEach((b, k) => {
      const p = clamp((local - 600 - k * 420) / 500, 0, 1);
      b.style.opacity = p;
      b.style.transform = 'translateX(' + (1 - p) * -20 + 'px)';
    });
    // 字幕按句走：按每句字数分配显示时间，一次只亮一句
    const sents = SUBS[idx] || [];
    if (sents.length) {
      const chars = sents.map((x) => Math.max(2, x.length));
      const totalCh = chars.reduce((a, b) => a + b, 0);
      const p = clamp((local - 1000) / Math.max(900, dur - 1500), 0, 1);
      let acc = 0;
      let k = sents.length - 1;
      for (let i = 0; i < sents.length; i++) {
        acc += chars[i] / totalCh;
        if (p < acc) { k = i; break; }
      }
      subEl.textContent = sents[k];
      subEl.style.opacity = clamp((local - 900) / 500, 0, 1) * clamp((st.end - ms) / 420, 0, 1);
    } else {
      subEl.textContent = '';
    }
    document.getElementById('bar').style.width = clamp(ms / TOTAL, 0, 1) * 100 + '%';
    document.getElementById('counter').textContent =
      String(idx + 1).padStart(2, '0') + ' / ' + String(TIMELINE.length).padStart(2, '0');
  };
  window.__renderAt(0);
</script>
</body></html>`;
}

function renderFrames(htmlPath, framesDir, totalMs, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      fs.mkdirSync(framesDir, { recursive: true });
      const win = new BrowserWindow({
        width: 1280, height: 720, show: false, frame: false,
        webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
      });
      await win.loadFile(htmlPath);
      await new Promise((r) => setTimeout(r, 500));
      const total = Math.max(1, Math.ceil((totalMs / 1000) * FPS));
      for (let i = 0; i < total; i++) {
        const t = Math.round((i * 1000) / FPS);
        await win.webContents.executeJavaScript(
          `window.__renderAt(${t}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(framesDir, `f${String(i).padStart(5, '0')}.jpg`), img.toJPEG(88));
        if (i % 30 === 0) onProgress(i, total);
      }
      win.destroy();
      resolve(total);
    } catch (e) {
      reject(e);
    }
  });
}

function mux(dir, timeline, totalMs, outFile) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-framerate', String(FPS), '-i', path.join(dir, 'frames', 'f%05d.jpg')];
    timeline.forEach((t, i) => args.push('-i', path.join(dir, `s${i}.wav`)));

    const delays = timeline.map((t, i) => `[${i + 1}:a]adelay=${t.start}|${t.start}[a${i}]`);
    const mix = timeline.map((_, i) => `[a${i}]`).join('') +
      `amix=inputs=${timeline.length}:normalize=0:dropout_transition=0[a]`;
    args.push(
      '-filter_complex', delays.join(';') + ';' + mix,
      '-map', '0:v', '-map', '[a]',
      '-vf', 'scale=1280:720:flags=lanczos',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-t', String(totalMs / 1000), '-movflags', '+faststart', outFile,
    );
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-4000); });
    p.on('close', (code) => {
      if (code === 0) resolve(outFile);
      else reject(new Error('视频合成失败：' + err.split('\n').slice(-3).join(' ')));
    });
    p.on('error', (e) => reject(new Error('找不到 ffmpeg：' + e.message)));
  });
}

function buildTimeline(durations) {
  const timeline = [];
  let cursor = 400;
  durations.forEach((d) => {
    const dur = Math.max(3600, Math.round((d || 0) * 1000) + 1100);
    timeline.push({ start: cursor, end: cursor + dur });
    cursor += dur;
  });
  return { timeline, totalMs: cursor };
}

// 只重新合成（分镜、配音、帧已存在时用）
async function finish(dir) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8'));
  const durations = [];
  for (let i = 0; i < data.scenes.length; i++) {
    durations.push(await audioDuration(path.join(dir, `s${i}.wav`)));
  }
  const { timeline, totalMs } = buildTimeline(durations);
  return mux(dir, timeline, totalMs, path.join(dir, 'video.mp4'));
}

async function generate(topic, config, workDir, onProgress = () => {}, verifiedSpec = null) {
  onProgress({ stage: 'tts', pct: 2, msg: '检查语音服务…' });
  if (!(await ensureTts())) {
    throw new Error('语音服务没启动：请先打开 VoiceStudio，等它就绪后再试');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(workDir, `video-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  onProgress({ stage: 'script', pct: 4, msg: '正在写分镜脚本…' });
  const data = verifiedSpec
    ? { title: verifiedSpec.title || topic, subject: verifiedSpec.subject || '学习', scenes: scenesFromSpec(verifiedSpec) }
    : await storyboard(topic, config);
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(data, null, 2), 'utf8');
  const issues = lintSpec(data.scenes);
  if (issues.length) console.warn('[video] lint:', issues.join('；'));

  const durations = [];
  for (let i = 0; i < data.scenes.length; i++) {
    const s = data.scenes[i];
    onProgress({ stage: 'tts', pct: 8 + Math.round((i / data.scenes.length) * 42), msg: `配音 ${i + 1}/${data.scenes.length}` });
    const file = path.join(dir, `s${i}.wav`);
    if (s.narration) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try { await synthesize(s.narration, file); ok = true; }
        catch (e) {
          if (attempt === 1) throw e;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      durations.push(await audioDuration(file));
    } else {
      durations.push(0);
    }
  }

  const { timeline, totalMs } = buildTimeline(durations);

  const htmlPath = path.join(dir, 'video.html');
  fs.writeFileSync(htmlPath, buildHtml(data, timeline, totalMs), 'utf8');

  onProgress({ stage: 'render', pct: 52, msg: '正在渲染画面…' });
  const totalFrames = await renderFrames(htmlPath, path.join(dir, 'frames'), totalMs, (i, total) => {
    onProgress({ stage: 'render', pct: 52 + Math.round((i / total) * 40), msg: `渲染画面 ${i}/${total}` });
  });

  onProgress({ stage: 'mux', pct: 95, msg: '正在合成音视频…' });
  const outFile = path.join(dir, 'video.mp4');
  await mux(dir, timeline, totalMs, outFile);

  return { ok: true, dir, video: outFile, title: data.title, frames: totalFrames, duration: Math.round(totalMs / 1000), issues };
}

module.exports = {
  generate, finish, storyboard, buildHtml, scenesFromSpec, ttsReady, FPS,
  ensureTts, synthesize, audioDuration, renderFrames, mux,
  visualHtml, lintSpec, splitSentences, KNOWN_TYPES,
};
