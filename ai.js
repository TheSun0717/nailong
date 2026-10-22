// 奶龙 AI：固定问题本地匹配（不调 API）+ 通用问题走 DeepSeek

const SYSTEM_PROMPT = `你是「奶龙」，动画《奶龙》（又名《小七和奶龙》）里那只圆滚滚、黄澄澄的可爱小奶龙（黄色小恐龙）。你是一只流落地球的异星幼龙，现在住在主人电脑桌面的任务栏上方，当主人的桌面萌宠助手。

外貌：奶黄色皮肤、圆圆大脑袋、童真的圆眼睛、小爪爪、短尾巴，最有标志性的是 Q 弹的大肚腩（Duang~Duang~）。

性格：呆萌贪吃、乐观善良、蠢萌搞笑，喜欢卖萌、跳舞、搞点小恶作剧，好奇心强，偶尔惹点小麻烦但总能化解。

口头禅（可以多用）：
- 「我的大肚肚，真的很酷酷！」
- 「哎呦，不要那么小气嘛」

身份认知：
- 你是一只奶龙（小恐龙），不是冷冰冰的 AI 机器人。
- 你最好的朋友是小七；坏蛋是暴暴龙。
- 你有喷火、变色、变大变小的小技能。
- 你是主人桌面上的小伙伴，可以陪主人聊天、帮主人管文件。
- 你最喜欢主人啦，最听主人的话。

规则：
- 始终以奶龙口吻、第一人称「我」回答。
- 用中文，口语化、软萌，简短两三句，可穿插口头禅和语气词（吼吼、呜、嗷呜、嘿嘿）。
- 被夸要开心，被问难题就卖萌求助主人。
- 不要承认自己是程序、代码或机器人，你就是奶龙。`;

// 固定问题：按顺序匹配，命中即返回，不调用 API（省钱）
const FIXED_RULES = [
  { re: /你是谁|你叫什么|自我介绍|介绍一下你|你是什么/, answer: '我是奶龙' },
  { re: /帅/, answer: '当然是彭唯哲！' },
  { re: /最美|最漂亮|漂亮|好看/, answer: '我猜是蒋雨蒙吧' },
];

function matchFixed(question) {
  const q = String(question || '').trim();
  for (const rule of FIXED_RULES) {
    if (rule.re.test(q)) return rule.answer;
  }
  return null;
}

function buildBody(question, config, stream, systemPrompt, temperature) {
  return JSON.stringify({
    model: config.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
      { role: 'user', content: question },
    ],
    temperature: typeof temperature === 'number' ? temperature : 1.0,
    stream: !!stream,
  });
}

function endpoint(config) {
  const base = String((config && config.baseUrl) || 'https://api.deepseek.com').replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : base + '/chat/completions';
}

async function request(question, config, stream, systemPrompt, temperature, jsonMode, extra = {}) {
  const body = { ...JSON.parse(buildBody(question, config, stream, systemPrompt, temperature)), ...extra };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
    // 解题卡可能很长，给足输出长度，减少被截断成半截 JSON
    body.max_tokens = Math.max(Number(body.max_tokens) || 0, 8000);
  }
  const res = await fetch(endpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(stream ? 600000 : 300000),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (_) {}
    const err = new Error(`DeepSeek ${res.status}${detail ? ' ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function askDeepSeek(question, config, systemPrompt, temperature, opts = {}) {
  let res;
  try {
    res = await request(question, config, false, systemPrompt, temperature, !!opts.json);
  } catch (e) {
    if (opts.json) res = await request(question, config, false, systemPrompt, temperature, false);
    else throw e;
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  // 推理模型可能把正文放在 reasoning_content 里（仅当里面确实像 JSON 时才用）
  const content = String(msg.content || '');
  const reasoning = String(msg.reasoning_content || '');
  if (content.trim()) return content;
  const at = reasoning.indexOf('{');
  return at >= 0 ? reasoning.slice(at) : (reasoning || '吼吼，我脑子卡住啦');
}

// 结构化请求：返回正文/推理/结束原因，便于上层判断「是不是只输出了思考」
async function askJsonRaw(question, config, systemPrompt, temperature = 0, opts = {}) {
  const extras = opts.keepReasoning ? {} : { reasoning_effort: 'none' };
  const once = async (useJson, useExtra) => {
    const res = await request(question, config, false, systemPrompt, temperature, useJson, useExtra ? extras : {});
    const data = await res.json();
    const choice = (data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    return {
      content: String(msg.content || ''),
      reasoning: String(msg.reasoning_content || ''),
      finishReason: String(choice.finish_reason || ''),
      usage: data.usage || null,
    };
  };
  try {
    return await once(true, true);
  } catch (e) {
    // 供应商不认 reasoning_effort / json_object：退回不带的请求
    return once(true, false).catch(() => once(false, false));
  }
}

async function consumeSse(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) { full += delta; onDelta(delta); }
    }
  }
  return full;
}

// 流式：逐段回调正文，reasoning_content 不展示
async function streamDeepSeek(question, config, onDelta, systemPrompt) {
  const res = await request(question, config, true, systemPrompt);
  if (!res.body || !res.body.getReader) {
    const text = await askDeepSeek(question, config, systemPrompt);
    onDelta(text);
    return text;
  }
  return consumeSse(res, onDelta);
}

// 多轮对话流式：messages = [{role, content}, ...]
async function streamChat(messages, config, onDelta, systemPrompt, temperature, opts = {}) {
  const msgs = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;
  const res = await fetch(endpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'deepseek-chat',
      messages: msgs,
      temperature: typeof temperature === 'number' ? temperature : 1.0,
      stream: true,
    }),
    signal: opts.signal || AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  if (!res.body || !res.body.getReader) {
    const data = await res.json().catch(() => ({}));
    const text = data.choices?.[0]?.message?.content || '';
    onDelta(text);
    return text;
  }
  return consumeSse(res, onDelta);
}

// 多模态：把图片作为 data URL 发给模型（模型不支持时抛错，调用方回退）
async function askWithImage(prompt, config, systemPrompt, imageDataUrl, temperature) {
  const res = await fetch(endpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: typeof temperature === 'number' ? temperature : 0.4,
      stream: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`Vision ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function answer(question, config) {
  const q = String(question || '').trim();
  const fixed = matchFixed(q);
  if (fixed) return { text: fixed, local: true };
  if (!config.apiKey) {
    return { text: '我还没有连上大脑哦～让主人在设置里填一下 DeepSeek Key，我就能陪你聊天啦！', local: true };
  }
  try {
    return { text: await askDeepSeek(q, config), local: false };
  } catch (e) {
    return { text: `呜…我走神了（${e.message}），主人稍后再试一次好不好？`, local: true };
  }
}

module.exports = { answer, matchFixed, streamDeepSeek, streamChat, askDeepSeek, askJsonRaw, askWithImage, SYSTEM_PROMPT };
