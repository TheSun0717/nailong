# 大模型 API 配置指南

> 最后校验：2026-10-21
> 说明：各家控制台改版很频繁，步骤以「找 API Keys / 创建密钥」为准；如果页面变了，按关键词找即可。
> 奶龙的「设置 → 服务商配置」可以打开这份文档；也可以直接问奶龙「DeepSeek 的 API 怎么配置」。

## 目录

1. [DeepSeek](#deepseek)
2. [OpenAI](#openai)
3. [Anthropic Claude](#anthropic)
4. [Google Gemini](#gemini)
5. [阿里通义千问（DashScope）](#qwen)
6. [月之暗面 Kimi](#kimi)
7. [智谱 GLM](#glm)
8. [字节豆包（火山方舟）](#doubao)
9. [OpenRouter](#openrouter)
10. [硅基流动](#siliconflow)

---

<a id="deepseek"></a>
## 1. DeepSeek

- **申请地址**：https://platform.deepseek.com
- **控制台路径**：登录 → 左侧「API Keys」→「创建 API Key」→ 复制（只显示一次）
- **API Base**：`https://api.deepseek.com`
- **常用模型**：`deepseek-chat`（通用）、`deepseek-reasoner`（推理）
- **是否需要充值**：需要，按 token 计费
- **步骤**：
  1. 手机号/邮箱注册并登录；
  2. 充值（少量即可测试）；
  3. API Keys → 创建 → 复制 `sk-...`；
  4. 回到奶龙：设置 → API Key 粘贴 → 保存 → 点「测试连接」。
- **常见问题**：
  - `401`：Key 错或已删除；
  - `402`：余额不足；
  - `model not found`：模型名写错，先用 `deepseek-chat`。

---

<a id="openai"></a>
## 2. OpenAI

- **申请地址**：https://platform.openai.com
- **控制台路径**：登录 → API keys → Create new secret key → 复制 `sk-...`
- **API Base**：`https://api.openai.com/v1`
- **常用模型**：`gpt-4o`、`gpt-4o-mini`、`gpt-4.1`
- **是否需要充值**：需要（国内访问可能需要网络代理）
- **步骤**：注册 → Billing 充值 → API keys 创建 → 复制 → 填进奶龙。
- **常见问题**：`insufficient_quota` 是没余额；`country not supported` 是地区限制。

---

<a id="anthropic"></a>
## 3. Anthropic Claude

- **申请地址**：https://console.anthropic.com
- **控制台路径**：登录 → API Keys → Create Key → 复制 `sk-ant-...`
- **API Base**：`https://api.anthropic.com/v1`
- **常用模型**：`claude-sonnet-5-5`、`claude-opus-5-5`、`claude-haiku-5-5`
- **是否需要充值**：需要
- **步骤**：注册 → Plans & Billing 充值 → API Keys 创建 → 填进奶龙。
- **注意**：Anthropic 的接口协议和 OpenAI 不完全一样；奶龙当前的内置调用是 OpenAI 兼容格式，接入 Anthropic 需要选「Anthropic 兼容」适配器（开发中）。

---

<a id="gemini"></a>
## 4. Google Gemini

- **申请地址**：https://aistudio.google.com/apikey
- **控制台路径**：Google AI Studio → Get API key → Create API key → 复制
- **API Base（OpenAI 兼容）**：`https://generativelanguage.googleapis.com/v1beta/openai/`
- **常用模型**：`gemini-2.5-pro`、`gemini-2.5-flash`
- **是否需要充值**：有免费额度，超出后按量计费
- **步骤**：Google 账号登录 → 创建 Key → 填进奶龙（Base URL 用上面的兼容地址）。

---

<a id="qwen"></a>
## 5. 阿里通义千问（DashScope）

- **申请地址**：https://dashscope.console.aliyun.com
- **控制台路径**：登录 → API-KEY 管理 → 创建新的 API-KEY → 复制
- **API Base（OpenAI 兼容）**：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- **常用模型**：`qwen-plus`、`qwen-max`、`qwen-turbo`
- **是否需要充值**：有免费额度，超出按量
- **步骤**：阿里云账号 → 开通 DashScope → 创建 Key → 填进奶龙。

---

<a id="kimi"></a>
## 6. 月之暗面 Kimi

- **申请地址**：https://platform.moonshot.cn
- **控制台路径**：登录 → API Key 管理 → 新建 → 复制
- **API Base**：`https://api.moonshot.cn/v1`
- **常用模型**：`moonshot-v1-8k`、`moonshot-v1-32k`、`kimi-k2`
- **是否需要充值**：需要
- **步骤**：注册 → 充值 → 创建 Key → 填进奶龙。

---

<a id="glm"></a>
## 7. 智谱 GLM

- **申请地址**：https://open.bigmodel.cn
- **控制台路径**：登录 → 控制台 → API Keys → 创建 → 复制
- **API Base**：`https://open.bigmodel.cn/api/paas/v4`
- **常用模型**：`glm-4-plus`、`glm-4-flash`
- **是否需要充值**：有免费模型，付费模型按量
- **步骤**：注册 → 实名（如要求）→ 创建 Key → 填进奶龙。

---

<a id="doubao"></a>
## 8. 字节豆包（火山方舟）

- **申请地址**：https://console.volcengine.com/ark
- **控制台路径**：登录 → 火山方舟 → 模型推理 → 接入点管理 → 创建接入点 → 得到 `ep-...`；再到 API Key 管理创建 Key
- **API Base**：`https://ark.cn-beijing.volces.com/api/v3`
- **常用模型**：接入点 ID（`ep-xxxxxxxx`），不是模型名
- **是否需要充值**：需要
- **注意**：豆包的 `model` 字段要填「接入点 ID」，不是 `doubao-...` 名称。

---

<a id="openrouter"></a>
## 9. OpenRouter

- **申请地址**：https://openrouter.ai/keys
- **控制台路径**：登录 → Keys → Create Key → 复制 `sk-or-...`
- **API Base**：`https://openrouter.ai/api/v1`
- **常用模型**：`openai/gpt-4o`、`anthropic/claude-sonnet-5-5`、`deepseek/deepseek-chat` 等（一个 Key 接多家）
- **是否需要充值**：需要（信用卡或加密货币）
- **适合**：想用一个 Key 接多家模型的人。

---

<a id="siliconflow"></a>
## 10. 硅基流动

- **申请地址**：https://cloud.siliconflow.cn
- **控制台路径**：登录 → API 密钥 → 新建 → 复制 `sk-...`
- **API Base**：`https://api.siliconflow.cn/v1`
- **常用模型**：`deepseek-ai/DeepSeek-V3`、`Qwen/Qwen2.5-72B-Instruct`
- **是否需要充值**：有免费额度
- **步骤**：注册 → 创建 Key → 填进奶龙；模型名要用「厂商/模型」全名。

---

## 在奶龙里怎么填

1. 点聊天窗右上角 ⚙；
2. 填 API Key；
3. 模型名按上面各家的「常用模型」填；
4. 如果你的供应商是 OpenAI 兼容接口（DeepSeek/通义/Kimi/GLM/OpenRouter/硅基流动/Gemini 兼容地址），奶龙当前可直接使用；
5. 保存后发一句话测试；报错看上面的「常见问题」。

## 安全说明

- Key 只存在本机，不会上传到奶龙的服务器（奶龙没有服务器）；
- 公开仓库不包含任何 Key；
- 换电脑需要重新填。
