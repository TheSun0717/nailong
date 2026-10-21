// 作品库：讲解页与视频的持久列表（重启后仍可打开）
const fs = require('fs');
const path = require('path');

function list(explainDir, videoDir) {
  const out = [];
  try {
    for (const f of fs.readdirSync(explainDir)) {
      if (!f.toLowerCase().endsWith('.html')) continue;
      const p = path.join(explainDir, f);
      const st = fs.statSync(p);
      out.push({ type: 'explain', name: f.replace(/\.html$/i, ''), path: p, ts: st.mtimeMs });
    }
  } catch {}
  try {
    for (const d of fs.readdirSync(videoDir)) {
      const dir = path.join(videoDir, d);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        const mp4 = path.join(dir, 'video.mp4');
        if (!fs.existsSync(mp4)) continue;
        let name = d;
        try {
          const sb = JSON.parse(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8'));
          if (sb && sb.title) name = sb.title;
        } catch {}
        out.push({ type: 'video', name, path: mp4, ts: fs.statSync(mp4).mtimeMs });
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
}

module.exports = { list };
