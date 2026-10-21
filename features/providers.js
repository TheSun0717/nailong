// 大模型 API 配置助手：命中供应商 + 配置类问题时，用内置文档回答。
const fs = require('fs');
const path = require('path');

const DOC_PATH = path.join(__dirname, '..', 'data', 'docs', 'llm-providers.md');
const PROVIDER_RE = /(deepseek|openai|anthropic|claude|gemini|通义|qwen|dashscope|kimi|moonshot|glm|智谱|豆包|doubao|火山方舟|openrouter|硅基流动|siliconflow)/i;
const ASK_RE = /(api\s*key|api密钥|密钥|配置|申请|接入|怎么填|怎么用|在哪|base\s*url|模型名)/i;

function doc() {
  return fs.readFileSync(DOC_PATH, 'utf8');
}

function shouldUse(question) {
  const q = String(question || '');
  return PROVIDER_RE.test(q) && ASK_RE.test(q);
}

function buildSystem(question) {
  return `你是「奶龙」的 API 配置助手。用户问的是某个大模型供应商的 API 配置问题。

规则：
- 只依据下面的内置文档回答；文档里没有的信息不要编造。
- 先给一句话结论（在哪申请、API Base、常用模型名），再给 3 到 6 步操作，最后给 2 到 3 条常见错误。
- 如果文档标注了「OpenAI 兼容」，明确告诉用户奶龙当前可以直接用。
- 如果文档标注需要适配器（例如 Anthropic 原生协议），如实说明。
- 中文、简洁、可执行。

内置文档：
${doc()}

用户的问题：${question}`;
}

module.exports = { shouldUse, buildSystem, doc, DOC_PATH };
