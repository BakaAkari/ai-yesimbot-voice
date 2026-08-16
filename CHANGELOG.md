# Changelog

## [0.6.5] - 2026-08-16

### 文档与设置页文案：补全 TTS 系统部署 + 音色风格文件设计指南

- **README 重写**：补齐「部署本插件所用的 CosyVoice3 TTS 系统」章节（Docker 部署、`/inference_zero_shot` 端点契约、短文本 llm.py 补丁、zero_shot 定制音色=参考音频+转写、无需 fine-tune 说明），以及「音色文件设计指南」（如何做一份高质量参考音频、txt 真实转写、年轻女声 F0 筛选 250-310Hz、版权注意）。同时修正了 README 里过时/错误的配置表（对齐当前实际 schema）。
- **设置页顶部 hint 排版**：重排为分节短行（音色文件 / 当前音色），可读性更好。

无功能逻辑改动。

## [0.6.4] - 2026-08-16

### 方案C：当前音色统一以 settings.json 为唯一真源（移除 Config.voice 双真源）

**背景**：音色存在两处各存一份——`settings.json`（`.voice` 命令写、合成读）与 Koishi 配置页的 `config.voice`（koishi.yml 里的 `voice:`）。两者只同步一半：聊天里 `.voice` 切音色，配置页永不更新，形成误导性的双真源。

**改动**：
- 从插件 `Config` schema **移除 `voice` 字段** → 控制台设置页不再有音色下拉（杜绝「改了配置页却与 settings 不同步」的错觉）。
- `resolveCurrentVoice()` 删掉对 `config.voice` 的回退，**只读 settings.json**；无 settings 时回退 `'auto'`（音色目录第一个）。
- 移除 30s 轮询的音色动态下拉注册（`yesimbot-voice.voices` dynamic source）——已无字段引用。
- 音色切换唯一入口 = `.voice` 命令（写 settings.json，即时生效，重启不丢）。

**行为**：音频音色真源从两个收敛为一个。`settings.json` 缺失/损坏时回退目录第一个音色（auto），行为同旧默认。

**注意**：老配置 koishi.yml 里若残留 `voice: <name>`，字段已从 schema 移除会自然被忽略；NAS 部署时建议顺手删掉该残留行（可选清理）。

**验证**：typecheck ✅（发布时 prepublishOnly 自动 clean+build dist）。
**手测入口**：部署后 `.voice` 查看/切换正常；控制台设置页不再显示音色下拉；`.voice mabaoguo` 后合成即用新音色（settings.json 唯一来源）。

## [0.6.3] - 2026-08-16

### 修复：语音链路在插件热重载后失效（use_voice / 吞文本静默失效，只发文字）

**现象**：热重载（如 market 更新插件 / 控制台改配置触发 apply）后，`use_voice` 工具被调用（日志有 `use_voice tool invoked`），但回复只发出纯文本、不再转语音——`text replaced by voice (forced)` 与 `voice sent` 日志完全消失。

**根因**：`pendingVoice / turnSegments / forceVoiceChannels / lastSpeakAt` 四个运行时状态 Map 声明在 `apply()` 内，生命周期绑定**插件实例**闭包。但 sendMessage patch 用 `bot._akaVoicePatched` 布尔值保证每个 bot **只 patch 一次**——热重载会新建一个 `apply()` 实例（新闭包新 Map），而 bot 对象与它已挂载的旧 patch 不重建。于是：
- 投递仍走**旧实例**闭包里的 patch，读的是**旧 Map**；
- 新实例的 `use_voice` / `.说话` / `onAppend` 写的是**新 Map**；
- 两边永远脱节 → `isForceArmed` / `isTurnReply` 恒 false → 回复以纯文本漏发，语音永不触发。

**改动**：把四个运行时状态统一挂到 **bot 对象**（`bot._akaVoiceState`，懒创建）上，与插件实例生命周期解耦。`sendMessage` patch、`use_voice` 工具、`.说话` 命令、`onAppend`、`onTurnFinish`、`consumePending`/`queuePending`/`isForceArmed` 全部改从 `voiceState(bot)` 读写同一份状态。热重载后新旧实例共享同一 bot 状态，不再漂移。

**验证**：typecheck ✅（发布时 prepublishOnly 自动 clean+build dist）。
**手测入口**：部署后在测试群 @米塔「用语音工具给我发语音」→ 应看到 `text replaced by voice (forced)` + `voice sent`，群内收到语音、不再只有文字。

## [0.6.2] - 2026-08-15

### 修复：`.voice <音色名>` 切换命令失效（单命令 `voice [name]`）

**背景**：`.voice <音色名>` 无法切换音色——在群里发 `.voice mabaoguo` 只会打印音色列表，从不执行切换（`voice switched` 日志从未出现，settings.json 一直不变）。

**根因**：代码里注册了**两个独立命令** `ctx.command('voice')` 和 `ctx.command('voice <name>')`。Koishi 把它们当两个命令，`.voice mabaoguo` 被匹配到**无参 `voice` 命令**，参数 `mabaoguo` 被吞掉，因此只走「查看列表」分支，永不触发切换。

**改动**：合并为**单个命令** `ctx.command('voice [name]')`，在一个 action 内用可选参数分支：
- `.voice` → 查看当前/全部音色
- `.voice <音色名>` → 切换（写 settings.json 即时生效）

**验证**：typecheck ✅ / 65 测试全绿 ✅ / build ✅；容器部署重启后插件注册正常无报错。

## [0.6.1] - 2026-08-15

### 修复：音色切换改为热重载即时生效（settings.json 动态真源）

**背景**：在 Koishi 控制台改 `voice` 字段保存后，多次出现「生成了语音却仍是上一音色」。根因是 `resolveCurrentVoice()` 依赖「插件加载时读一次的内存变量 `savedVoiceOverride`」和「Koishi 保存配置是否会更新 `config` 对象引用」——两者都不可靠（容器长期不重启时，内存仍锁旧音色），导致必须完整重启才生效。

**改动**：
- `resolveCurrentVoice()` 改为**每次现读 `settings.json` 作为动态真源**（优先级最高），settings 不存在时回退 `config.voice`。彻底去掉对「Koishi 是否更新 config 引用」的内存依赖。
- `.voice <name>` 命令移除内存缓存，只写 `settings.json`；现读逻辑每次自动取到最新值。

**效果**：
- `.voice <音色名>` → 立即生效，无需重启
- 手动改 `settings.json` → 下次合成立即生效（每次现读）
- 控制台改 `config.voice` → 无 settings 覆盖时生效

**验证**：typecheck ✅ / 65 测试全绿 ✅ / build ✅；容器部署后启动日志 `registered (voice=leijun)` ✅，模型网关正常无 `route_failed` ✅。

## [0.6.0] - 2026-08-11

### 新增：给 yesimbot LLM 注册正式语音工具 `use_voice`（米塔可主动决定用语音说）

**目标**：让米塔能「正规地」决定用语音说话，而不是靠 prompt 标记或概率。给 yesimbot LLM 注册一个真正的工具 `use_voice`，米塔想用语音（喊话/强调/应群友要求）时主动调用。

- `registerChannelPlugin` 返回的 `AgentPlugin` 新增 `tools`，定义一个 `use_voice` 工具
  - `execute` 只在当前频道的 `forceVoiceChannels` 打强制语音标记（复用 `.说话` 的 force-voice 截流通道，100% 走语音、不做概率/策略判定）
  - 工具名/description 让 LLM 知道「何时用」：用户明确要求语音、或想用喊话/强调/有情绪的方式表达时
- **实现选择**：用 `AgentPlugin.tools`（非废弃字段），而非简报建议的 `extendTools`
  - 已在 `@yesimbot/agent-runtime` 源码验证：runtime 对 `tools`（`mergeTools([nextTools, declared])`）与 `extendTools` 都是 **merge 语义**，都会与基础工具（sendMessage/read 等）合并、**不会覆盖**，结果等价
  - `extendTools` 在 d.ts/README 标记为 deprecated，官方推荐 `AgentPlugin.tools`（`tools: AgentToolSet | ((runtime) => ...)`）
- 不影响 v0.5.0 已有的音色扫描 / `.voice` 切换 / 柯莱默认音色配置

**验证**：typecheck ✅、`npm run build` ✅（dist 已含 `use_voice`）、65 项测试全绿 ✅。待本地/线上手测确认工具被米塔识别并触发语音。

## [0.5.0] - 2026-08-10

### 新增：设置页顶部说明 + 明确音色目录

- 插件配置页顶部新增一段**纯文字介绍**（干练）：说明这是语音插件、把回复转语音发到 QQ 群、音色目录 `data/aka-yesimbot-voice/voices`（可在 `voiceDir` 修改）、以及新增音色的方法（放入 `<音色名>.wav` + 同名 `<音色名>.txt`，txt 为该 wav 参考音频的真实转写，重启生效出现在 voice 下拉）
- 实现：Config schema 顶部新增 `hint` 说明字段（纯信息，不参与业务）

## [0.4.2] - 2026-08-10

### 重构：与 ai 包彻底解耦（移除安装界面里多余的 `ai >=5` 可选依赖）

**背景**：Koishi 安装该插件时显示 `ai >=5 可选` 依赖。源码只把 `ai` 用于 TypeScript 类型与 `generateText`，运行时本就是复用 Koishi 宿主（yesimbot）里的 `ai` 包，无需插件自身声明。

- `package.json`：从 `peerDependencies` / `peerDependenciesMeta` / `devDependencies` 移除 `ai`（只保留 `koishi` peer）
- `llm-channel.ts`：删除 `import type { LanguageModel } from 'ai'` 与 `as LanguageModel` 类型断言
- `vendor/yesimbot-types.d.ts`：`import { LanguageModel, EmbeddingModel } from 'ai'` → 本地最小结构类型
- 新增 `src/vendor/ai-shim.d.ts`：`declare module 'ai'`（仅让 tsc 通过，不安装该包）
- 运行时 `await import('ai')` 保留：从 Koishi 宿主取现成 `ai`（外置、不上报依赖，标准 Koishi 模式）
- 结果：Koishi 插件安装界面不再出现 `ai` 依赖

## [0.4.1] - 2026-08-10

### 修复：语音切换链路不可诊断 / 静默回退音色

**背景**：实测切换音色后输出听感未变（始终像 halo_marine）。原 `voice sent` 日志**不记录实际使用的音色与 wav 路径**，导致无法判断走了哪个音源。

- **日志诊断**：`voice sent` 日志新增 `voice=<实际音色> path=<wav路径>`，明确每次合成用了哪个参考音频
- **暴露静默回退**：`resolve` 对"具名音色请求但匹配不上"时原会静默回退到排序第一个（= halo_marine）。现 `currentVoice()` 在请求名≠解析名时**显式 `logger.warn('voice resolve MISMATCH …')`**，不再掩盖配置/扫描异常
- **说明**：若实际日志显示 `voice=halo_marine` 且请求名没匹配 → 根因是运行时 `config.voice`/`settings.json` 解析到 `auto`/不匹配，据此修正配置即可；若日志显示 `voice=<目标>` 仍听感相同 → 则是模型的粗粒度音色克隆所致（不同男性参考被合成相近音色），需换更区分的参考音频

## [0.4.0] - 2026-08-10

### 迁移：instruct2 → zero_shot（完全迁移）

**背景**：instruct2 质量不佳；服务端 `/inference_instruct2` 已被改造成 zero_shot 语义（`instruct_text` 槽位实际作为参考音频转写 prompt_text 使用），旧调用方填入朗读指令会把它当正文念出来。

**音色方案（收在插件内，不依赖 NAS 音色库路径）**
- 音色 = `voiceDir` 下的 `<name>.wav` + `<name>.txt`（转写）。插件直接从插件内目录读取，更新音源 = 覆盖这两个文件。
- `voices.ts`：`VoiceInfo` 新增 `transcript`，扫描时读取同名 `<name>.txt`（回退 `ref_transcript.txt`）。
- 音色库 4 个可用音色的 `<name>.txt` 已按 NAS 训练侧认证转写落盘到 voiceDir。

**TTS 客户端（tts-client.ts）**
- 端点由 `/inference_instruct2` → `/inference_zero_shot`，字段 `instruct_text` → `prompt_text`。
- `synthesize(text, outDir, outName, voice: {path, transcript})`：prompt_text = 该音色的参考转写；服务端自动补 `<|endofprompt|>`。
- 删除配置 `instructText`（接口字段 + Schema 一并移除，不再有任何残留）。

**验证**：单测 59 过；真实音源（halo_marine / mabaoguo）经 `/inference_zero_shot` 出干净人声（voiced 0.5+），无指令泄漏。

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
