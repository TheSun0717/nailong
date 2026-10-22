// 本地知识库：文本抽取 → 分块 → BM25 检索（个人规模，不引数据库）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 80;

let index = null; // { version, docs: [], chunks: [{ docId, i, text, tf }] }
let indexPath = '';

function init(dir) {
  indexPath = path.join(dir, 'index.json');
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(index.chunks)) throw new Error('bad index');
  } catch {
    index = { version: 1, docs: [], chunks: [] };
  }
}

function save() {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index));
}

// 中文按「单字 + 相邻二元组」，英文/数字按词切
function tokenize(text) {
  const tokens = [];
  const s = String(text || '').toLowerCase();
  const ascii = s.match(/[a-z0-9_]+/g);
  if (ascii) tokens.push(...ascii);
  const cjk = s.replace(/[^一-龥]+/g, ' ');
  for (const seg of cjk.split(' ')) {
    for (let i = 0; i < seg.length; i++) {
      tokens.push(seg[i]);
      if (i + 1 < seg.length) tokens.push(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

function termFreq(tokens) {
  const tf = Object.create(null);
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

function chunkText(text) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];
  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };

  for (const p of paras) {
    if (p.length > CHUNK_SIZE) {
      flush();
      for (let i = 0; i < p.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(p.slice(i, i + CHUNK_SIZE));
        if (i + CHUNK_SIZE >= p.length) break;
      }
      continue;
    }
    if ((buf + '\n\n' + p).length > CHUNK_SIZE) flush();
    buf = buf ? buf + '\n\n' + p : p;
  }
  flush();
  return chunks;
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.md', '.markdown', '.txt', '.csv'].includes(ext)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (ext === '.pdf') {
    const pdf = require('pdf-parse');
    const data = await pdf(fs.readFileSync(filePath));
    return data.text || '';
  }
  if (['.docx', '.doc'].includes(ext)) {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
    return out.value || '';
  }
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
    const err = new Error('图片需要先 OCR，请把文字粘贴成 .md 或 .txt 再导入');
    err.code = 'NEED_OCR';
    throw err;
  }
  throw new Error('暂不支持的文件类型：' + ext);
}

async function importFiles(filePaths, meta = {}) {
  const added = [];
  for (const fp of filePaths) {
    let text;
    try {
      text = await extractText(fp);
    } catch (e) {
      added.push({ name: path.basename(fp), error: e.message });
      continue;
    }
    const chunks = chunkText(text);
    if (!chunks.length) {
      added.push({ name: path.basename(fp), error: '没有抽到文字' });
      continue;
    }
    const doc = {
      id: crypto.randomBytes(6).toString('hex'),
      name: meta.name || path.basename(fp),
      source: meta.source || '本地文档',
      kind: meta.kind || 'notes', // experience | method | syllabus | notes
      sourceUrl: meta.sourceUrl || '',
      school: meta.school || '',
      course: meta.course || '',
      level: meta.level || '',
      ts: Date.now(),
      chars: text.length,
    };
    index.docs.push(doc);
    chunks.forEach((t, i) => {
      index.chunks.push({ docId: doc.id, i, text: t, tf: termFreq(tokenize(t)) });
    });
    added.push({ name: doc.name, id: doc.id, chunks: chunks.length });
  }
  save();
  return added;
}

function list() {
  return index.docs.map((d) => ({
    ...d,
    chunks: index.chunks.filter((c) => c.docId === d.id).length,
  }));
}

function remove(id) {
  index.docs = index.docs.filter((d) => d.id !== id);
  index.chunks = index.chunks.filter((c) => c.docId !== id);
  save();
  return true;
}

// 插件写入一段文字（不需要走文件导入）
function addText(name, text, meta = {}) {
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('没有可用的文字');
  const doc = {
    id: crypto.randomBytes(6).toString('hex'),
    name: String(name || meta.name || '插件写入').slice(0, 80),
    source: meta.source || '插件',
    kind: meta.kind || 'notes',
    sourceUrl: meta.sourceUrl || '',
    school: meta.school || '',
    course: meta.course || '',
    level: meta.level || '',
    ts: Date.now(),
    chars: String(text).length,
  };
  index.docs.push(doc);
  chunks.forEach((t, i) => index.chunks.push({ docId: doc.id, i, text: t, tf: termFreq(tokenize(t)) }));
  save();
  return { id: doc.id, chunks: chunks.length };
}

// BM25（k1=1.5, b=0.75）
function search(query, opts = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !index.chunks.length) return [];
  const limit = opts.limit || 5;
  const N = index.chunks.length;
  const avgdl = index.chunks.reduce((n, c) => n + Object.values(c.tf).reduce((a, b) => a + b, 0), 0) / N;

  const qTerms = [...new Set(qTokens)];
  const df = Object.create(null);
  for (const t of qTerms) {
    let n = 0;
    for (const c of index.chunks) if (c.tf[t]) n++;
    df[t] = n;
  }
  const idf = Object.create(null);
  for (const t of qTerms) idf[t] = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));

  const docById = Object.fromEntries(index.docs.map((d) => [d.id, d]));

  const scored = index.chunks.map((c) => {
    const dl = Object.values(c.tf).reduce((a, b) => a + b, 0);
    let s = 0;
    for (const t of qTerms) {
      const f = c.tf[t];
      if (!f) continue;
      s += idf[t] * ((f * 2.5) / (f + 1.5 * (0.25 + 0.75 * dl / avgdl)));
    }
    const doc = docById[c.docId] || {};
    if (opts.school && doc.school && doc.school === opts.school) s *= 1.5;
    if (opts.course && doc.course && doc.course === opts.course) s *= 1.3;
    if (opts.level && doc.level && doc.level === opts.level) s *= 1.15;
    // 经验/方法类资料在「怎么学」类问题里优先，但不过度压过用户自己的讲义
    const kindBoost = { experience: 1.45, method: 1.2, syllabus: 1.15, notes: 1 };
    s *= kindBoost[doc.kind] || 1;
    return { score: s, text: c.text, doc };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({
      score: Math.round(x.score * 100) / 100,
      text: x.text,
      source: x.doc.name || '未命名',
      kind: x.doc.kind || 'notes',
      school: x.doc.school || '',
      course: x.doc.course || '',
      level: x.doc.level || '',
    }));
}

const SEED_NAMES = {
  'study-methods.md': '内置学习法 · 通用学习与复习',
  'experience-bupt-ai.md': '内置经验 · 北邮 AI 课程',
  'experience-ml-roadmap.md': '内置经验 · 机器学习路线',
  'experience-math.md': '内置经验 · 数学与期末复习',
  'experience-xhs.md': '内置经验 · 小红书学长学姐',
};

// 同校加权用的元数据
const SEED_META = {
  'experience-bupt-ai.md': { school: '北京邮电大学', level: '本科' },
};

// 内置资料每个文件只导入一次
async function ensureSeeds(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (!file.toLowerCase().endsWith('.md')) continue;
    const name = SEED_NAMES[file] || `内置资料 · ${path.basename(file, '.md')}`;
    const existing = index.docs.find((d) => d.seed && d.name === name);
    if (existing) {
      const meta = SEED_META[file] || {};
      let changed = false;
      for (const [k, v] of Object.entries(meta)) {
        if (existing[k] !== v) { existing[k] = v; changed = true; }
      }
      if (changed) save();
      continue;
    }
    const kind = file.startsWith('experience-') ? 'experience' : 'method';
    const before = index.docs.length;
    await importFiles([path.join(dir, file)], { source: '内置资料', name, kind, ...(SEED_META[file] || {}) });
    if (index.docs.length > before) {
      const doc = index.docs[index.docs.length - 1];
      doc.seed = true;
      save();
    }
  }
}

module.exports = { init, importFiles, list, remove, search, chunkText, tokenize, ensureSeeds, addText, extractText };
