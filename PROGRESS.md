# aka-yesimbot-voice 开发进度（2026-08-07 会话交接）

## 项目

- repo: `github.com/BakaAkari/ai-yesimbot-voice`（public）
- npm 包: `koishi-plugin-aka-yesimbot-voice` **v0.1.0（2026-08-07 已发布）**
- 设计文档: `koishi-dev/plans/yesimbot-tts-design.md`
- 功能: yesimbot v4 回复 → NAS CosyVoice3 TTS → QQ 群语音
- **v0.1.0 新增**：`replaceText`（命中语音吞文本只发语音，TTS 失败补发文本）；`napcatHttpUrl`（NapCat HTTP API 直发语音，修复 sendMessage record 假成功）
- 待验证：`replaceText` 端到端被 yesimbot 模型链路阻塞（models.json 校验时序 bug，另一 agent 修中）

## 已完成 ✅

1. 插件实现：`onTurnFinish` 钩子 → 提取回复文本 → 策略判定 → TTS 合成 → 语音发送
   - `src/tts-client.ts`（instruct2 multipart + WAV 封装 + 自动补 `<|endofprompt|>`）
   - `src/text-extract.ts`（assistant content 提取 + `<message>` 标签剥离）
   - `src/policy.ts`（概率/长度/冷却/群聊，`isShared` 用 scope.type）
   - `src/sender.ts`（**直调 NapCat HTTP API 发语音，见下**）
   - `src/index.ts`（Schema + `inject: ['yesimbot']` 必选 + `napcatHttpUrl` 配置）
2. 单测 22 条全绿 + typecheck + build
3. 真实 TTS e2e 验证：4859 音色 + 中英混排 ≈ 6-11s 合成，WAV 有效（24kHz mono）
4. GitHub 仓库 + 全部提交已 push（含 dist，NAS 免 build 部署）
5. NAS 部署：node_modules 放置 + koishi.yml 配置 + 音色文件
6. 插件在 mita_koishi 加载注册成功（`aka-yesimbot-voice registered platforms=onebot`）
7. **语音发送卡点已打通**（2026-08-07 18:47 端到端验证，见下）

## 语音发送卡点（已解决 ✅ 2026-08-07）

**根因**：Koishi `bot.sendMessage(record)` 在 onebot 适配器下是**假成功**——插件日志 `voice sent`，
但 NapCat 侧无任何消息记录（`get_group_msg_history` 查 98 条消息 0 条 record，群里实际看不到语音）。

**方案 A 已验证成功**：插件 sender 直调 NapCat HTTP API：
- endpoint: `POST http://mita_napcat:6199/send_group_msg`（容器名跨 docker 网络可达，NapCat 4.15.0）
- payload: `{group_id: 群号, message: [{type: 'record', data: {file: 'base64://<WAV base64>'}}]}`
- NapCat 自动转码 amr 并上传 QQ CDN
- 新增配置 `napcatHttpUrl`（默认空 = 回退 Koishi 元素发送，NAS 生产配置 `http://mita_napcat:6199`）

**验证证据**（2026-08-07 18:47）：
- Koishi 日志 `voice sent channel=463029480 ... voice-1786099617594.wav`（新代码路径）
- NapCat `get_msg` message_id=580732975 复核：`message_type=group`、`group_id=463029480`、
  `sender=Mita`、`segment type=record`、`file_size=32444`、CDN url 存在

## 部署/调试备忘

- 部署：本地 build → tar dist+package.json → scp NAS /tmp → `docker cp` 进 mita_koishi → 重启
  （比 wget tarball 更直接；容器内无 curl 有 wget/python3/node）
- koishi.yml 插件块：`group:1zgb8f` 下 `aka-yesimbot-voice:25yasi`（probability 1.0 测试值，**验证后调回 0.2**）
  - `napcatHttpUrl: http://mita_napcat:6199`（2026-08-07 加入；改前备份 /tmp/koishi.yml.bak.20260807-184221）
- 音色：NAS `/koishi/data/aka-yesimbot-voice/voice-4859.wav`（1.3MB）；源 Mac `/tmp/voices/ai_news_4859.wav`
- TTS：`http://100.121.167.1:50000/inference_instruct2`，`prompt_wav` 必填 + `instruct_text` 必带 `<|endofprompt|>`（缺 → 服务端 AssertionError → HTTP 200 空体）
- 测试群：**463029480**（人在回路，yesimbot allowedChannels 第一项）
- 插件日志：Koishi 日志搜 `aka-yesimbot-voice`（voice candidate / skip voice / voice sent / voice failed）

## 已踩坑（修复记录）

| 坑 | 修复 |
|---|---|
| ESM 插件 Koishi require 加载失败（cannot resolve） | main 改 CJS：tsup esm+cjs，`main: dist/index.js` |
| `Package subpath './package.json' is not defined by exports` | package.json exports 加 `"./package.json"` |
| optional inject 不触发加载重排（yesimbot service 未注册） | `inject: ['yesimbot']` 必选 |
| groupOnly 判断失败（yesimbot channelId 无 `group:` 前缀） | 用 `scope.type === 'shared'` 判断 |
| 回复带 `<message>` 标签被 TTS 念出 | text-extract 剥离 XML 标签 |
| instruct2 缺 `<|endofprompt|>` → 服务端空响应 | TtsClient 自动补全 |
| record 裸路径/file:// 经 Koishi sendMessage 假成功，NapCat 无记录 | **直调 NapCat HTTP API + base64:// record**（方案 A，已验证） |

## 环境拓扑备忘

- mita_koishi（NAS，koishijs/koishi）：onebot 适配器 selfId=522773162，ws-reverse path=/onebot
- mita_napcat（NAS）：账号 522773162 配置 `onebot11_522773162.json`，HTTP server 6199（hermes-http）+ WS client 连 `ws://koishi:5140/onebot`；宿主机只暴露 6099（WebUI），6199 仅 docker 网络内可达
- 容器间：mita_koishi 内 `wget/node/python3` 可访问 `http://mita_napcat:6199`
- 群 628731557 = 卡林不妙屋（正式群，活跃）；463029480 = 人在回路（测试群）

## 外部干扰

- 另一个 agent 曾频繁调试 yesimbot（改 dist temperature、装 music-voice 插件、反复重启 mita_koishi）——测试会互相干扰，确认环境稳定后再验证
- yesimbot 启动警告：`Ignoring models.json chat default "deepseek:deepseek-v4-flash" because it is not a registered chat model`（可能影响回复，另一个 agent 处理中）
- 群 463029480 的 turn 曾卡死在工具调用（sticker_search 等），onTurnFinish 需 turn 完成才触发
