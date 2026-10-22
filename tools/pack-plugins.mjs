// 把 plugins/<id> 打成商店 zip，算出 SHA-256，输出可直接粘进 updates.json 的 plugins 条目。
// 用法：node tools/pack-plugins.mjs v2.0.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateManifest } = require('../features/plugins.js');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'plugins');
const OUT = path.join(ROOT, 'dist', 'plugins');
const tag = process.argv[2] || 'v' + require('../package.json').version;
const base = `https://github.com/TheSun0717/nailong/releases/download/${tag}/`;

const entries = [];
const problems = [];

for (const id of fs.readdirSync(SRC)) {
  const dir = path.join(SRC, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { problems.push(`${id}: manifest 读不了（${e.message}）`); continue; }

  const errors = validateManifest(manifest);
  if (errors.length) { problems.push(`${id}: ${errors.join('；')}`); continue; }
  // 带 main.js 的插件必须是第一方（走签名流程）；纯声明式插件可以直接打包
  const hasCode = !!(manifest.entry && manifest.entry.main);
  if (hasCode && !manifest.firstParty) { problems.push(`${id}: 有 main.js 但不是 firstParty，跳过（需要签名流程）`); continue; }

  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${manifest.id}-${manifest.version}.zip`);
  zip.writeZip(file);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  entries.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    minAppVersion: manifest.minAppVersion,
    description: manifest.description,
    intro: manifest.intro,
    url: base + path.basename(file),
    sha256,
    mirrors: ['https://ghproxy.net/' + base + path.basename(file)],
  });
  console.log(`${manifest.id}@${manifest.version} → ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

fs.writeFileSync(path.join(OUT, 'plugins.json'), JSON.stringify(entries, null, 2));
console.log('\n' + JSON.stringify(entries, null, 2));
if (problems.length) console.error('\n跳过：\n- ' + problems.join('\n- '));
if (!entries.length) process.exit(1);
