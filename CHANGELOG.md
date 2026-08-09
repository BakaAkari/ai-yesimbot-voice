# Changelog

## [0.3.0] - 2026-08-09

### 重大重构：音色库 + 配置极简化（无旧配置兼容负担）

**多音色库**
- 新增 `VoiceLibrary`：扫描 `voiceDir`（默认 `data/aka-yesimbot-voice/voices`）里的 `*.wav` 作为可用音色
- **管理员增删音色 = 往 voiceDir 放/删 wav 文件**（重启生效）；`<1KB` 空壳/损坏文件自动跳过
- `.voice` 指令：管理员查看可用音色列表
- `.voice <音色名>` 指令：切换当前音色，持久化到 `settings.json`（重启不丢）

**配置极简化（17 平铺字段 → 4 基础 + 1 折叠组）**
- 基础：`voice`(auto)、`probability`(0.85)、`llm`(true)、`voiceDir`
- advanced 折叠隐藏：`ttsApiBase`/`instructText`/`ttsTimeoutMs`/`minLength`/`maxLength`/`cooldownSeconds`/`groupOnly`/`onMentionOnly`/`replaceText`/`napcatHttpUrl`
- 删除 `platforms`/`outputDir`/`logFailures` 等硬编码进默认

**音色动态切换**
- `tts-client` 改为把音色路径在合成时传入（支持运行时切音色）
- `voice`/settings 优先级：settings.json 覆盖 config.voice

### 随带发布（此前 v0.2.0 prep 未单独发版）
- LLM 语音效果渲染层：规则层 + yesimbot/custom LLM 通道 + 内容保真校验 + [breath] 注入
- 断点优化：LLM 改写降级规则层、prosody 注入等

## [0.1.1] - 2026-08-07

### 修复
- **replaceText 收紧为"只吞 yesimbot 回复"**：改用 onAppend 记录 turn 的 `<message>` 段，发送出口只吞"文本与某 turn 回复段一致"的调用——**指令返回文本/其他插件发送永不吞**（此前是全局拦截，可能误吞指令返回）
- replaceText 模式改为 per-turn 插件实例（registerChannelPlugin resolver 每次 turn 调用），移除单例 currentChannelCtx 状态串扰隐患
- sendMessage patch 增加防重复标记（`_akaVoicePatched`），避免多 turn 叠加包装

## [0.1.0] - 2026-08-07

首个发布版本。

### 功能
- yesimbot v4 回复经 NAS CosyVoice3 TTS 合成语音发送 QQ 群
- 策略控制：概率 / 最短最长长度 / 同渠道冷却 / 仅群聊
- **`replaceText`（新）**：命中语音策略时吞掉 yesimbot 文本回复，只发语音；TTS 失败自动补发文本兜底
- **`napcatHttpUrl`（新）**：直调 NapCat HTTP API 发送语音（base64 record），修复 Koishi `bot.sendMessage(record)` 假成功问题
- 中英混排：CosyVoice3 instruct2 + 朗读指令（服务端对短文本自动降级 bare，避免念出指令）

### 修复
- `bot.sendMessage(record)` 假成功（NapCat 侧无记录）→ NapCat HTTP API 直发（`send_group_msg` + `base64://` record）
- ESM 插件 Koishi require 加载失败 → CJS main（tsup esm+cjs）
- `Package subpath './package.json' is not defined by exports` → exports 补 `./package.json`
- optional inject 不触发加载重排 → `inject: ['yesimbot']` 必选
- groupOnly 判断失败（channelId 无 `group:` 前缀）→ 用 `scope.type === 'shared'`
- 回复带 `<message>` 标签被 TTS 念出 → text-extract 剥离
- instruct2 缺 `<|endofprompt|>` → 服务端空响应 → TtsClient 自动补全

### 已知限制
- `replaceText` 端到端验证被 yesimbot 模型链路问题阻塞（`models.json` 校验时序在 provider 注册前，default 模型被忽略，turn 卡住）——另一 agent 处理中
- 短文本（<110 字）服务端自动用 bare 指令，英文词发音无 instruct 指导（如 "add"→"edit" 级别偏差）；完整英文预处理层为后续优化
