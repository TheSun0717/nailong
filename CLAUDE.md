# 奶龙（Nailong）项目级 CLAUDE.md

> 版本：1.1.1 → 2.0.0（插件化重构中）
> 更新：2026-10-21
> 本文件随实施进度实时更新；所有复杂改动先读本文件。

## 1. 目标与非目标

**目标**
- 桌面萌宠「奶龙」+ 学习/教学助手，功能以**插件**形式扩展。
- 内置应用商店：安装、更新、卸载、依赖、权限说明、小学生能看懂的简介。
- 主程序与插件都能在线更新，更新前展示更新日志。
- 登录型资料采集：先征得用户同意，再打开可见浏览器让用户登录。
- 内置 LLM 供应商配置文档与 API Key 配置助手。

**非目标**
- 不做各校真题库（无合法公开来源），只做「用户导入 + 学习通个人数据 + 牛客题库」。
- 不保存用户的平台账号密码/Cookie。
- 不把作者或用户的邮箱密码写进客户端。

## 2. 不可破坏的约束

1. **协议令牌不得入代码库**：API Key 用 `safeStorage` 加密；反馈走表单直投。
2. **第三方插件无 Node**：只能调用能力总线白名单；自由 HTML 仅限签名插件。
3. **生成型插件模板化**：模型只填声明式配置，不写任意 HTML。
4. **更新必须可回滚**：保留上一版安装包与上一版插件目录。
5. **每次发版校验供应商路径**：`tools/check-providers.mjs`，失败或变动写入更新日志。
6. **中文 UI，奶龙口吻；插件简介必须小学生能懂。**

## 3. 架构总览

进程与窗口（Electron 44）：

- `main.js`：主进程；窗口、托盘、IPC、更新、插件宿主、能力总线。
- `preload.js`：`window.nailong` 白名单桥。
- `ui/chat.html`：聊天 + 任务标签栏 + 商店 + 设置（单页多视图）。
- `ui/pet.html`：桌宠；默认躺下，悬停站立，双击全屏眨眼。
- `ui/explain.html` / `video` 输出：独立窗口，沙箱。
- 手机端：`android/`（Capacitor），`ui/bridge-web.js` 提供同款 API。

数据目录（`app.getPath('userData')`）：

```
config.json              主配置（API Key 密文）
data/conversations/*.json
data/kb/                 知识库
data/plugins/<id>/       已安装插件
data/plugin-state.json   启用状态、版本、安装来源
data/docs/llm-providers.md
data/video|explain/      产物
```

开发/正式隔离：开发版 → 项目内 `.userdata`；安装版 → 若存在 `D:/nailong-data` 则用它（本机已迁），否则 userData。

## 4. 插件系统（核心契约）

### 4.1 包结构

```
<plugin-id>/
  manifest.json
  icon.png
  README.md            # 四字段简介（商店展示）
  ui/                  # 声明式面板或签名插件的 HTML
  main.js              # 仅第一方签名插件；导出 register(host)
  assets/
```

### 4.2 manifest.json

```json
{
  "id": "study-kit",
  "name": "学习资料助手",
  "version": "1.0.0",
  "minAppVersion": "2.0.0",
  "description": "一句话说明",
  "intro": {
    "what": "它是干什么的",
    "how": "点哪里",
    "whatHappens": "会发生什么",
    "ifFails": "失败了怎么办"
  },
  "permissions": ["kb", "ai", "web", "notify"],
  "capabilities": ["study.plan", "kb.search"],
  "dependencies": { "teach-studio": "^1.0.0" },
  "entry": { "type": "module", "main": "main.js" },
  "icon": "icon.png",
  "sha256": "<发布时写入>"
}
```

- `permissions` 与 `capabilities` 分离：前者是宿主资源，后者是插件对外提供的能力。
- `dependencies` 支持能力拼装：安装「学习助手」时可一键拉「讲解工坊」。
- 版本遵循 semver；`minAppVersion` 不满足时商店显示「需要更新奶龙」。

### 4.3 能力总线（host API）

插件（或生成型面板）只能调用：

| 能力 | 说明 |
|---|---|
| `chat.command(name, handler)` | 注册命令/快捷入口 |
| `kb.search(query)` / `kb.add(text, meta)` | 知识库读写 |
| `ai.ask(prompt)` / `ai.stream(prompt, onDelta)` | 大模型调用（用用户配置的 Key） |
| `web.open(url)` / `web.search(platform, query)` | 打开网页；平台搜索（B站/小红书/知乎） |
| `video.make(topic)` | 调用宿主视频流水线 |
| `ui.panel(template, data)` | 渲染 list/form/steps 三种模板 |
| `store.install(id, version)` | 安装依赖插件 |
| `notify(text)` / `pet.say(text)` | 通知/桌宠气泡 |
| `settings.get/set` | 插件私有存储 |
| `cron.schedule(expr, fn)` | 定时任务，最小间隔 10 分钟，可在设置中关闭 |

所有调用带 `pluginId`，宿主校验 manifest 中的 `permissions`。

### 4.4 面板模板

只允许三种，宿主统一渲染，杜绝样式/脚本注入：

- `list`：标题 + 条目（图标、主副文本、按钮动作）
- `form`：字段（文本/数字/下拉/开关）+ 提交动作
- `steps`：分步卡片（标题、正文、可选图示、下一步）

### 4.5 生成型插件（Prompt-to-Plugin）五道闸

1. 模型只输出声明式 JSON（schema 固定）；
2. JSON Schema 校验；
3. 权限/能力白名单校验；
4. 样例数据冒烟测试（每个动作 mock 执行）；
5. 失败自动修复 ≤2 次；仍失败标「未验证」，提供「它哪里不对」反馈按钮。

生成结果先在「试衣间」沙箱预览，用户确认后才安装。

### 4.6 权限与签名

- 官方插件：第一方签名，可含 `main.js` 与自由 HTML。
- 第三方/生成型：声明式，无 Node，无自由 HTML。
- 侧载：允许，但显示「未签名插件可读取聊天与知识库」强警告。
- 校验：商店索引提供 SHA-256；下载后校验，不符拒绝安装。

### 4.7 安装 / 更新 / 卸载 / 回滚

- 安装：下载 zip → 校验 SHA-256 → 解压到临时目录 → 校验 manifest → 移入 `data/plugins/<id>` → 写 `plugin-state.json`。
- 更新：同流程，旧目录保留为 `<id>.bak`；启动失败自动回滚。
- 卸载：删除目录；保留用户数据（如插件私有 settings）可选导出。

### 4.8 简介规则

`intro` 四字段必填，缺一不可上架；商店用漫画卡片 + 奶龙朗读；README 可补充截图。

## 5. 应用商店

- 分区：推荐 / 已安装 / 可更新 / 能力工坊。
- 详情页：四字段简介、权限列表、截图、版本与更新日志、安装/更新/卸载。
- 能力工坊：一句话造插件入口（常驻），附「试衣间」预览。
- 离线：缓存上次索引，显示「离线，展示缓存」。

## 6. 更新协议

`updates.json`（GitHub raw，主通道 + 镜像）：

```json
{
  "app": {
    "version": "2.0.0",
    "minVersion": "1.5.0",
    "url": "https://github.com/TheSun0717/nailong/releases/download/v2.0.0/nailong-Setup-2.0.0.exe",
    "sha256": "...",
    "notes": { "summary": "...", "items": ["..."] },
    "evolutionVideo": "https://.../evolution-2.0.0.mp4"
  },
  "plugins": [
    { "id": "study-kit", "version": "1.2.0", "minAppVersion": "2.0.0",
      "url": ".../study-kit-1.2.0.zip", "sha256": "...",
      "notes": { "summary": "...", "items": ["..."] } }
  ],
  "catalogVersion": "2026-10-21"
}
```

- 通道：v1 仅 stable；预留 beta。
- 主程序：完整 NSIS 包，不做差量；保留上一版安装包用于回滚。
- 检查：启动 5 秒后、每 6 小时、设置里手动。
- 流程：检查 → 弹更新日志（文字 + 可选预渲染动画）→ 用户点下载 → 进度 → 重启安装。
- 进化动画：**发版时预渲染** 20–30 秒，随包分发；首启播放，可跳过；失败降级文字。
- 供应商目录校验：发版跑 `tools/check-providers.mjs`，变动写入更新日志。

## 7. 登录型资料采集

- 首次使用某平台弹授权：「是否允许奶龙读取你在 XX 的公开内容？」允许/拒绝，记住选择。
- 浏览器三层：
  1. Chromium 系（Chrome 推荐，Edge/Brave/Vivaldi 可用）→ OpenCLI 扩展；商店打不开时用 release 里的 Load unpacked 离线安装；
  2. 无可用浏览器 → 奶龙内置 Electron 浏览器窗口（独立会话，持久化）；
  3. 非登录搜索（B站/Exa）不需要浏览器。
- 登录窗口必须用户主动点开；不自动登录；不保存密码/Cookie。
- 首版平台：小红书、知乎、学习通、知网。

## 8. LLM 供应商目录与 API Key

- 文档：`data/docs/llm-providers.md`，带目录；应用内 Markdown 查看器打开，不依赖 WPS。
- 首版供应商：DeepSeek、OpenAI、Gemini、通义（DashScope）、Kimi、GLM、豆包（火山方舟）、OpenRouter、硅基流动。
- 每家字段：申请地址、控制台路径、Base URL、常用模型 ID、配置步骤、常见报错、最后校验日期。
- 存储：`safeStorage` 加密；换机需重填。
- 设置页：每家一个「测试连接」；下方固定提示「可以试着询问：怎样进行 DeepSeek 的 API 配置操作」。
- 聊天助手：按目录回答，给「打开设置」按钮。
- 发版校验各家控制台/文档 URL 与 API Base，变动即更新 md 与 `catalog-status.json`。

## 9. 问题反馈

- 文案：「如有任何使用中的问题或者小建议请联系作者」。
- 输入框 + 可选回复邮箱 + 发送 → FormSubmit AJAX 直投 `2491695554@qq.com`（零后端、无密码；首次需在邮箱确认）。
- 下方固定一行：作者微信 `FromTheSun0717`。
- 发送失败保留草稿，并提供 `mailto:` 兜底。

## 10. 多标签 / 并发

- 顶部任务标签栏；每标签独立会话与任务状态；切换不中断后台任务。
- 长任务显示进度行（暂停/停止/失败重试）。
- 重任务（视频/爬取）并发上限 2，其余排队；队列可见。
- 任务完成用桌宠气泡/标签角标提示。
- 参考：ChatGPT 统一工作区标签、Cursor Agents Window、Manus Branch。

## 11. 桌宠设置

- 大小滑块 **0.5×–2.0×**；**窗口尺寸固定**（约 480×480 透明画布），不随滑块变化。
- 气泡总开关（关闭后不再自动弹气泡；双击彩蛋保留）。
- 默认姿态：躺下；悬停站立；双击全屏眨眼。
- 拖拽由主进程 12ms 跟随系统鼠标。

## 12. 发布流程

1. 版本号 + `updates.json` 更新；
2. `tools/check-providers.mjs` 校验供应商路径；
3. 预渲染进化动画；
4. `npm run dist` 生成安装包；`cap sync` + Gradle 生成 APK；
5. 计算 SHA-256，写 `updates.json`；
6. 创建 GitHub Release（安装包/插件包/动画/updates.json），push；
7. 验证：另一台机器检查更新 → 下载 → 安装 → 回滚。

## 13. 当前阶段与下一步

- [x] 需求 grilling（3 轮）与界限确认
- [x] 项目级 CLAUDE.md
- [x] 插件宿主 + manifest + 能力总线 + 命令/面板 + 示例插件（hello-plugin）
- [x] 商店基础（远程索引、zip + SHA-256、安装/更新、声明式命令、B站搜索插件）；自动回滚待补
- [x] 主程序在线更新（自研：检查/日志/下载校验/静默安装；net.fetch 走系统代理 + ghproxy 镜像）
- [ ] 学习助手 / 讲解工坊 插件化
- [x] 桌宠设置（0.5–2.0 缩放、独立画布 360–640、气泡开关）
- [x] 问题反馈（FormSubmit 直投 + 作者微信）
- [x] 供应商文档（应用内查看）+ API Key 助手 + 可配置 Base URL + 测试连接
- [x] 多标签任务（独立会话、后台继续、持久化）
- [x] 历史记录（打开中/归档，点击恢复）
- [x] 三栏工作台 + 商店左侧抽屉 + 窗口最小化/全屏
- [x] 资料搜索合并（B站/小红书/知乎/豆瓣/贴吧/微博/牛客/CSDN/掘金）
- [x] 插件自动路由（triggers + 查询清洗）
- [x] 讲解页 v2（结构化解题 + 二次校验 + JSON 模式 + 双解一致性 + SVG 图示 + SymPy/勾股/三角形不等式 + 解题卡持久缓存）
- [x] 多轮上下文（最近 12 条历史交给模型）+ 图片多模态尝试
- [x] 作品库（讲解页/视频重启后可再打开）
- [x] safeStorage 加密 API Key（DPAPI，自动迁移旧明文）
- [x] 能力工坊：声明式生成 + 五道闸 + 预览安装
- [ ] 预渲染进化动画

## 14. 已知限制

- 各校真题无合法公开来源，只能导入 / 学习通个人数据。
- 小红书搜索已内置：应用内 Chromium（persist 会话）+ 授权弹窗 + 登录检测 + DOM 提取；不再依赖 Chrome/OpenCLI。
- 第三方插件无 Node，复杂能力必须通过宿主白名单扩展。
- 发版校验只能验证公开 URL 可达性，无法验证需登录的页面结构。
