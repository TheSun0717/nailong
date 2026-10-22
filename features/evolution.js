// 进化动画：发版时预渲染成 assets/evolution.mp4，首启播放，可跳过。
// 文案在 data/evolution.json，渲染复用视频流水线的配音/逐帧/合成。
const fs = require('fs');
const os = require('os');
const path = require('path');
const video = require('./video');

const SCRIPT_FILE = path.join(__dirname, '..', 'data', 'evolution.json');
const PET_IMG = path.join(__dirname, '..', 'assets', 'pet', 'pose-stand.webp');

function loadScript(file = SCRIPT_FILE) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scenes = (j.scenes || []).map((s, i) => ({
    icon: String(s.icon || '✨').slice(0, 4),
    title: String(s.title || `第 ${i + 1} 部分`).slice(0, 40),
    bullets: (Array.isArray(s.bullets) ? s.bullets : []).slice(0, 3).map((b) => String(b).slice(0, 30)),
    narration: String(s.narration || s.title || '').slice(0, 400),
  })).filter((s) => s.narration);
  if (!scenes.length) throw new Error('data/evolution.json 里没有可用的 scenes');
  return { version: String(j.version || ''), kicker: String(j.kicker || '奶龙进化日志'), scenes };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildHtml(data, timeline, totalMs, petUrl) {
  const scenesHtml = data.scenes.map((s) => `
    <section class="scene">
      <div class="icon">${esc(s.icon)}</div>
      <h1>${esc(s.title)}</h1>
      <ul>${s.bullets.map((b) => `<li><span class="dot"></span><span>${esc(b)}</span></li>`).join('')}</ul>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 720px; overflow: hidden; background: #FFFBF2; }
  body { font-family: "Microsoft YaHei UI", "PingFang SC", sans-serif; color: #2E2419; }
  .bg { position: absolute; inset: 0; background: radial-gradient(rgba(58,42,26,.05) 1px, transparent 1px) 0 0 / 22px 22px; }
  .glow { position: absolute; right: -140px; top: 40px; width: 620px; height: 620px; border-radius: 50%;
          background: radial-gradient(circle at 50% 50%, rgba(255,201,60,.55), rgba(255,201,60,0) 68%); }
  .brand { position: absolute; left: 88px; top: 54px; font-size: 17px; letter-spacing: 4px; color: #B6A78E; }
  .scene { position: absolute; left: 0; top: 0; width: 760px; height: 720px; padding: 132px 0 150px 88px;
           display: flex; flex-direction: column; justify-content: center; }
  .icon { font-size: 54px; line-height: 1; margin-bottom: 22px; }
  h1 { font-size: 54px; line-height: 1.2; margin-bottom: 30px; letter-spacing: 1px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 18px; }
  li { font-size: 27px; line-height: 1.45; display: flex; gap: 14px; align-items: flex-start; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #F2A81D; margin-top: 15px; flex: 0 0 auto; }
  .sub { position: absolute; left: 88px; right: 88px; bottom: 62px; font-size: 21px; line-height: 1.55; color: #8A7860; }
  .pet { position: absolute; right: 92px; bottom: -12px; height: 700px; }
  .pet img { height: 100%; width: auto; display: block; filter: drop-shadow(0 20px 30px rgba(120,90,40,.18)); }
  .bar { position: absolute; left: 0; bottom: 0; height: 6px; width: 0; background: #F2A81D; }
</style></head>
<body>
  <div class="bg"></div>
  <div class="glow" id="glow"></div>
  <div class="brand">${esc(data.kicker)} · ${esc(data.version)}</div>
  <div class="pet" id="pet"><img src="${esc(petUrl)}" alt=""></div>
  <div id="scenes">${scenesHtml}</div>
  <p class="sub" id="sub"></p>
  <div class="bar" id="bar"></div>
<script>
  const TIMELINE = ${JSON.stringify(timeline)};
  const TOTAL = ${totalMs};
  const scenes = Array.from(document.querySelectorAll('.scene'));
  const icons = scenes.map((s) => s.querySelector('.icon'));
  const titles = scenes.map((s) => s.querySelector('h1'));
  const lists = scenes.map((s) => Array.from(s.querySelectorAll('li')));
  const sub = document.getElementById('sub');
  const bar = document.getElementById('bar');
  const pet = document.getElementById('pet');
  const glow = document.getElementById('glow');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  window.__renderAt = function (ms) {
    let idx = TIMELINE.length - 1;
    for (let i = 0; i < TIMELINE.length; i++) { if (ms < TIMELINE[i].end) { idx = i; break; } }
    const st = TIMELINE[idx];
    const local = ms - st.start;
    const enter = clamp(local / 520, 0, 1);
    const exit = clamp((st.end - ms) / 420, 0, 1);
    const op = Math.min(enter, exit);
    scenes.forEach((el, i) => {
      el.style.visibility = i === idx ? 'visible' : 'hidden';
      el.style.opacity = i === idx ? op : '0';
      el.style.transform = 'translateY(' + (i === idx ? (1 - enter) * 22 : 0) + 'px)';
    });
    icons[idx].style.transform = 'scale(' + (0.55 + 0.45 * clamp(local / 620, 0, 1)) + ')';
    titles[idx].style.opacity = clamp((local - 180) / 520, 0, 1);
    lists[idx].forEach((li, k) => {
      const p = clamp((local - 520 - k * 380) / 480, 0, 1);
      li.style.opacity = p;
      li.style.transform = 'translateX(' + (1 - p) * -18 + 'px)';
    });
    sub.textContent = ${JSON.stringify(data.scenes.map((s) => s.narration))}[idx];
    sub.style.opacity = clamp((local - 1100) / 700, 0, 1) * 0.95 * op;
    pet.style.transform = 'translateY(' + Math.sin(ms / 640) * 8 + 'px) rotate(' + Math.sin(ms / 950) * 1.6 + 'deg)';
    glow.style.transform = 'scale(' + (1 + Math.sin(ms / 1200) * 0.035) + ')';
    bar.style.width = clamp(ms / TOTAL, 0, 1) * 100 + '%';
  };
  window.__renderAt(0);
</script>
</body></html>`;
}

async function generate(outFile, scriptFile = SCRIPT_FILE, onProgress = () => {}) {
  const data = loadScript(scriptFile);
  onProgress({ stage: 'tts', pct: 2, msg: '检查语音服务…' });
  if (!(await video.ensureTts())) throw new Error('语音服务没启动：请先打开 VoiceStudio，等它就绪后再试');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(os.tmpdir(), `nailong-evolution-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const durations = [];
  for (let i = 0; i < data.scenes.length; i++) {
    onProgress({ stage: 'tts', pct: 5 + Math.round((i / data.scenes.length) * 45), msg: `配音 ${i + 1}/${data.scenes.length}` });
    const file = path.join(dir, `s${i}.wav`);
    await video.synthesize(data.scenes[i].narration, file);
    durations.push(await video.audioDuration(file));
  }
  const { timeline, totalMs } = buildTimeline(durations);

  const htmlPath = path.join(dir, 'evolution.html');
  fs.writeFileSync(htmlPath, buildHtml(data, timeline, totalMs, pathToFileURLSafe(PET_IMG)), 'utf8');

  onProgress({ stage: 'render', pct: 52, msg: '正在渲染画面…' });
  const frames = await video.renderFrames(htmlPath, path.join(dir, 'frames'), totalMs, (i, total) => {
    onProgress({ stage: 'render', pct: 52 + Math.round((i / total) * 40), msg: `渲染画面 ${i}/${total}` });
  });

  onProgress({ stage: 'mux', pct: 95, msg: '正在合成…' });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await video.mux(dir, timeline, totalMs, outFile);
  const result = { ok: true, video: outFile, dir, frames, duration: Math.round(totalMs / 1000), scenes: data.scenes.length };
  onProgress({ stage: 'done', pct: 100, msg: '完成' });
  return result;
}

// 进化动画要短：每镜至少 2.6 秒，旁白后留 0.7 秒
function buildTimeline(durations) {
  const timeline = [];
  let cursor = 250;
  durations.forEach((d) => {
    const dur = Math.max(2600, Math.round((d || 0) * 1000) + 700);
    timeline.push({ start: cursor, end: cursor + dur });
    cursor += dur;
  });
  return { timeline, totalMs: cursor };
}

function pathToFileURLSafe(p) {
  return require('url').pathToFileURL(p).href;
}

module.exports = { loadScript, buildHtml, generate };

// 自检：node features/evolution.js 只校验文案结构，不渲染
if (require.main === module) {
  const data = loadScript();
  const assert = require('assert');
  assert.ok(data.scenes.length >= 3, '至少 3 个镜头');
  for (const s of data.scenes) assert.ok(s.narration && s.title, '每镜都要有标题和旁白');
  console.log('evolution script OK · scenes=' + data.scenes.length + ' · v' + data.version);
}
