// 知识库最小回归：node tests/kb.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kb = require('../features/kb');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-kb-'));
kb.init(dir);

(async () => {
  const md = path.join(dir, '北邮-人工智能数学方法-学长经验.md');
  fs.writeFileSync(md, [
    '矩阵求导是这门课的基础，先把雅可比矩阵和链式法则推熟。',
    '',
    '凸优化部分重点看 KKT 条件，作业里经常出现。',
    '',
    '期末试卷重点是矩阵求导和 SVM 对偶，建议提前两周开始复习。',
  ].join('\n'), 'utf8');

  const imported = await kb.importFiles([md], { school: '北京邮电大学', level: '本科' });
  assert.strictEqual(imported.length, 1);
  assert.ok(imported[0].chunks >= 1, '应当切出至少一个片段');

  const hits = kb.search('矩阵求导怎么复习', { school: '北京邮电大学' });
  assert.ok(hits.length >= 1, '应当检索到片段');
  assert.ok(hits[0].text.includes('矩阵求导'), '首条命中应包含关键词');
  assert.strictEqual(hits[0].school, '北京邮电大学');

  assert.ok(kb.tokenize('矩阵求导').includes('矩阵'), '中文应切出二元组');

  const longChunks = kb.chunkText('字'.repeat(1500));
  assert.ok(longChunks.length >= 2, '超长段落应被切块');

  assert.ok(kb.list()[0].chunks >= 1);
  kb.remove(imported[0].id);
  assert.strictEqual(kb.list().length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('kb test OK · chunks=' + imported[0].chunks + ' hits=' + hits.length);
})().catch((e) => {
  console.error('kb test FAIL:', e);
  process.exit(1);
});
