# Changelog

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
