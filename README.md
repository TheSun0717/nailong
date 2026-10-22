# 奶龙 · 桌面学习助手

一只趴在任务栏上方的奶龙：陪你聊天、整理文件、规划学习，还能把题目做成可交互讲解页和讲解视频。

## 功能

**桌宠**
- 默认眨眼吐舌，待机呼吸 / 漂浮；悬停上浮、拖拽压扁并抱怨、单击摇头、双击粒子彩蛋
- 单击打开对话框；双击全屏彩蛋（每年 9/23 庆祝视频 + 生日歌）
- 快捷键 `Ctrl+Alt+D` 显示/隐藏；托盘；开机自启

**聊天**
- 奶油贴纸风界面，Markdown 渲染，流式输出，会话本地持久化
- 固定问答本地免联网：谁最帅 / 谁最美 / 你是谁

**学习助手**
- 画像：学段 / 省市 / 学校 / 专业 / 年级（🎓 按钮）
- 知识库：导入 PDF / Word / TXT / Markdown，本地 BM25 检索，同校同课程加权
- 问「这门课怎么学」→ 前置知识 / 分阶段计划 / 资料清单（带来源）/ 检验点，可存为 Markdown 笔记
- 学习回答下方可点「补充 B 站视频」，实时搜索公开课（无需登录）
- 搜索已内置：B站、小红书、知乎、豆瓣、贴吧、微博、牛客、CSDN、掘金；支持关键词自动触发插件
- 讲解页：结构化解题 + 双解一致性 + SymPy 符号验算 + 三角形不等式 + 动画分步 + SVG 图示 + 一句话直觉/生活比喻
- 讲解视频：复用已验证解题卡，SVG 图示逐元素绘制
- 错题本、能力工坊（一句话造插件）、插件进度条、作品库、历史记录、多标签
- 内置种子资料：通用学习法、北邮 AI 课程经验、机器学习入门路线、数学与期末复习、小红书学长学姐经验（均标注公开来源）；不编造校内试卷或学长原话

**插件与更新**
- 插件商店：安装 / 更新 / 卸载 / 依赖补装；每个插件都有「是什么、点哪里、会发生什么、失败了怎么办」四句话
- 第一方插件：学习资料助手（`/study`、`/kb-stats`）、讲解工坊（`/explain`、`/video`）、资料搜索（`/bili`、`/xhs`）、错题本（`/wrong-video` 把到期错题剪成复习短片）
- 主程序与插件都能在线更新：检查 → 更新日志 → 下载校验 SHA-256 → 静默安装
- 进化动画：发版时预渲染 20–30 秒，升级后首次启动播放一次，可跳过

**教学可视化**
- 直接说「讲解一下这道题」「做成视频」：自动识别并生成讲解页/讲解视频（不再需要点右侧按钮）
- 🎬：生成 5–7 个镜头的讲解视频（分镜 → 画面 → 配音 → MP4）
- 图片：本地 OCR + 自动抠出图里的插图（OpenCV），文字填回输入框，插图显示在对话里
- 左侧文件能直接拖进输入框；每条消息可复制；思考中可暂停（保留已生成内容）

**视频导演（2.1）**
- 11 种镜头：三角/坐标/受力/流程/圆/数轴 + 公式变形（formula）/板书（board）/聚光卡（spotlight）/错解正解对照（compare）/运镜（camera）
- 字幕按句切换；渲染前 lint；`--videostill` 抽帧验收
- 方法论：`docs/视频生成剖析与合并.md`；可复用 skill：`~/.claude/skills/nailong-videocraft/`

## 依赖

| 能力 | 依赖 |
|---|---|
| 文本抽取 | 已随项目安装：`pdf-parse`、`mammoth` |
| 图片 OCR | 系统 Python 3 + `pip install rapidocr_onnxruntime` |
| 视频配音 | VoiceStudio（本机 3900 端口，OmniVoice） |
| 视频合成 | ffmpeg / ffprobe 在 PATH |

## 开发

```bash
npm install   # Electron 二进制需镜像：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm start
```

开发与正式安装版使用不同的用户目录：开发版在 `%APPDATA%/nailong-dev`，不会和已安装版本抢单实例锁。

### 自检与截图

```bash
# 发一条消息并渲染（固定问答，不联网）
electron . --selftest

# 真实问一句（会调用 DeepSeek）
electron . --selftest --ask "我是北邮的，人工智能数学方法怎么学？"

# 生成全部界面截图到 shots/
electron . --capture

# 生成一条讲解视频（需要 VoiceStudio）
electron . --videotest "勾股定理的直观证明"

# 预渲染进化动画（发版时），并检查播放器
electron . --evolution
electron . --evotest

# 知识库回归
node tests/kb.test.js
```

## 打包（NSIS）

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist   # 产物在 dist/奶龙 Setup <版本>.exe
```

## 结构

| 文件 | 作用 |
|---|---|
| `main.js` | 主进程：窗口 / 托盘 / 自启 / 快捷键 / IPC / 讲解窗口 / 视频帧渲染 |
| `ai.js` | 人设提示词、固定问答、DeepSeek 流式与非流式调用 |
| `preload.js` | contextBridge 安全桥接 |
| `features/kb.js` | 知识库：抽取、分块、BM25、索引持久化 |
| `features/study.js` | 学习意图判断与学习路径提示词 |
| `features/teach.js` | 单文件 HTML 讲解页生成（含 CSP 锁定） |
| `features/video.js` | 分镜 → TTS → 逐帧渲染 → ffmpeg 合成 |
| `features/evolution.js` | 进化动画：`data/evolution.json` 文案 → 复用视频流水线预渲染 `assets/evolution.mp4` |
| `ui/evolution.html` | 升级后首启播放进化动画（可跳过） |
| `tools/ocr.py` | 本地 OCR 侧车 |
| `data/seed/` | 内置通用学习法 |
| `ui/` | pet / chat / fullscreen 三个页面 + 本地 marked、DOMPurify |
| `docs/竞品拆解.md` | 同类产品分析与取舍 |
| `docs/开发日志.md` | 每一步做了什么、实测结果、踩坑与修复 |
| `tools/xhs-search.sh` | 小红书搜索（绕过 OpenCLI 坏掉的站内搜索，直接抓 search_result DOM） |

## 手机 APK（Capacitor）

环境已装在 D 盘：JDK 21 `D:\nailong-tools\jdk`、Android SDK `D:\nailong-tools\android-sdk`、Gradle 缓存 `D:\nailong-tools\gradle-home`。

```bash
npm run android:sync
cd android
JAVA_HOME="D:/nailong-tools/jdk" ANDROID_HOME="D:/nailong-tools/android-sdk" \
ANDROID_SDK_ROOT="D:/nailong-tools/android-sdk" GRADLE_USER_HOME="D:/nailong-tools/gradle-home" \
./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

手机端通过 `ui/bridge-web.js` 实现同一套 `window.nailong` API：会话、画像、设置存 localStorage，聊天直连 DeepSeek（已验证 CORS）。资料导入、讲解页、视频生成仅在桌面端可用。

## 磁盘布局（本机）

- 源码：`D:\个人小项目
ailong`
- 开发数据：`D:\个人小项目
ailong\.userdata`
- 安装版程序：`D:
ailong-app`
- 安装版数据：`D:
ailong-data`
- Python 依赖（OCR/SymPy）：`D:
ailong-tools\py`
- Android/JDK/Gradle：`D:
ailong-tools`
- npm / Electron / electron-builder 缓存：`D:
ailong-tools`
- C 盘只保留系统与运行时不可避免的内容。

## 已知限制

- 同校试卷、学长经验无法自动获取，只能由用户导入。
- OCR 依赖系统 Python；打包分发时需要用户自备或后续内置。
- 视频渲染速度约每帧 60–100ms，5 分钟视频需要几分钟生成。
- 手机版只保留聊天与学习规划；资料导入、讲解页、视频生成需要桌面版。
