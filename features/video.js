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
- narration 是可直接朗读的口语中文，40 到 90 字；不要出现 Markdown、序号、括号符号、公式符号；数学表达式用中文念法（例如 a 的平方加 b 的平方等于 c 的平方）。
- 内容要准确、具体，不写空话。
- 每个镜头尽量带 visual：triangle（三角形，data 用 a/b/c/aLabel/bLabel/cLabel）、axes（坐标轴，data 用 points 数组）、flow（流程，data 用 nodes 数组）、none（不需要图）。
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

function buildHtml(data, timeline, totalMs) {
  const scenesHtml = data.scenes.map((s, i) => `
    <section class="scene${i === 0 ? ' active' : ''}">
      <div class="kicker">${esc(data.subject)}</div>
      <h1>${esc(s.title)}</h1>
      <div class="cols">
        <div class="txt"><ul>${s.bullets.map((b) => `<li><span class="dot"></span><span>${esc(b)}</span></li>`).join('')}</ul></div>
        ${svgForVisual(s.visual) ? `<div class="vis">${svgForVisual(s.visual)}</div>` : ''}
      </div>
      <p class="sub">${esc(s.narration)}</p>
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
</style></head>
<body>
  <div class="bg"></div>
  <div class="brand">奶龙讲解</div>
  <div class="counter" id="counter"></div>
  <div id="scenes">${scenesHtml}</div>
  <div class="bar" id="bar"></div>
<script>
  const TIMELINE = ${JSON.stringify(timeline)};
  const TOTAL = ${totalMs};
  const scenes = Array.from(document.querySelectorAll('.scene'));
  const titles = scenes.map((s) => s.querySelector('h1'));
  const bullets = scenes.map((s) => Array.from(s.querySelectorAll('li')));
  const subs = scenes.map((s) => s.querySelector('.sub'));
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
    const vis = scenes[idx].querySelector('.vis');
    if (vis) vis.style.transform = 'scale(' + (1 + 0.03 * clamp(local / (st.end - st.start), 0, 1)) + ')';
    const p1 = clamp(local / 700, 0, 1);
    titles[idx].style.opacity = p1;
    titles[idx].style.transform = 'translateY(' + (1 - p1) * 20 + 'px)';
    bullets[idx].forEach((b, k) => {
      const p = clamp((local - 600 - k * 420) / 500, 0, 1);
      b.style.opacity = p;
      b.style.transform = 'translateX(' + (1 - p) * -20 + 'px)';
    });
    const ps = clamp((local - 1400) / 700, 0, 1);
    subs[idx].style.opacity = ps * 0.95;
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
  const data = await storyboard(topic, config, verifiedSpec);
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(data, null, 2), 'utf8');

  const durations = [];
  for (let i = 0; i < data.scenes.length; i++) {
    const s = data.scenes[i];
    onProgress({ stage: 'tts', pct: 8 + Math.round((i / data.scenes.length) * 42), msg: `配音 ${i + 1}/${data.scenes.length}` });
    const file = path.join(dir, `s${i}.wav`);
    if (s.narration) {
      await synthesize(s.narration, file);
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

  return { ok: true, dir, video: outFile, title: data.title, frames: totalFrames, duration: Math.round(totalMs / 1000) };
}

module.exports = { generate, finish, storyboard, buildHtml, ttsReady, FPS };
