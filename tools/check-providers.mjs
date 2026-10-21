#!/usr/bin/env node
// 发版前校验供应商控制台 / API 地址是否可达，结果写入 data/docs/catalog-status.json
import fs from 'node:fs';

const targets = [
  { id: 'deepseek', kind: 'console', url: 'https://platform.deepseek.com' },
  { id: 'deepseek', kind: 'api', url: 'https://api.deepseek.com/models' },
  { id: 'openai', kind: 'console', url: 'https://platform.openai.com' },
  { id: 'openai', kind: 'api', url: 'https://api.openai.com/v1/models' },
  { id: 'anthropic', kind: 'console', url: 'https://console.anthropic.com' },
  { id: 'anthropic', kind: 'api', url: 'https://api.anthropic.com/v1/messages' },
  { id: 'gemini', kind: 'console', url: 'https://aistudio.google.com/apikey' },
  { id: 'gemini', kind: 'api', url: 'https://generativelanguage.googleapis.com' },
  { id: 'qwen', kind: 'console', url: 'https://dashscope.console.aliyun.com' },
  { id: 'qwen', kind: 'api', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models' },
  { id: 'kimi', kind: 'console', url: 'https://platform.moonshot.cn' },
  { id: 'kimi', kind: 'api', url: 'https://api.moonshot.cn/v1/models' },
  { id: 'glm', kind: 'console', url: 'https://open.bigmodel.cn' },
  { id: 'glm', kind: 'api', url: 'https://open.bigmodel.cn/api/paas/v4/models' },
  { id: 'doubao', kind: 'console', url: 'https://console.volcengine.com/ark' },
  { id: 'doubao', kind: 'api', url: 'https://ark.cn-beijing.volces.com/api/v3/models' },
  { id: 'openrouter', kind: 'console', url: 'https://openrouter.ai/keys' },
  { id: 'openrouter', kind: 'api', url: 'https://openrouter.ai/api/v1/models' },
  { id: 'siliconflow', kind: 'console', url: 'https://cloud.siliconflow.cn' },
  { id: 'siliconflow', kind: 'api', url: 'https://api.siliconflow.cn/v1/models' },
];

const results = [];
for (const t of targets) {
  const started = Date.now();
  try {
    const res = await fetch(t.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0' },
    });
    results.push({
      id: t.id, kind: t.kind, url: t.url, ok: true,
      status: res.status, final: res.url, ms: Date.now() - started,
    });
  } catch (e) {
    results.push({
      id: t.id, kind: t.kind, url: t.url, ok: false,
      error: e.message, ms: Date.now() - started,
    });
  }
}

const report = { checkedAt: new Date().toISOString(), targets: results };
fs.writeFileSync('data/docs/catalog-status.json', JSON.stringify(report, null, 2));

for (const r of results) {
  console.log(`${r.ok ? 'OK ' : 'ERR'} ${r.id.padEnd(12)} ${r.kind.padEnd(7)} ${r.status || ''} ${r.url}${r.error ? '  ' + r.error : ''}`);
}
