# aka-yesimbot-voice 开发进度（2026-08-07 会话交接）

## 项目

- repo: `github.com/BakaAkari/ai-yesimbot-voice`（public）
- npm 包: `koishi-plugin-aka-yesimbot-voice` v0.1.0（未发布）
- 设计文档: `koishi-dev/plans/yesimbot-tts-design.md`
- 功能: yesimbot v4 回复 → NAS CosyVoice3 TTS → QQ 群语音

## 已完成 ✅

1. 插件实现：`onTurnFinish` 钩子 → 提取回复文本 → 策略判定 → TTS 合成 → record 发送
   - `src/tts-client.ts`（instruct2 multipart + WAV 封装 + 自动补 `<|endofprompt|>`）
   - `src/text-extract.ts`（assistant content 提取 + `<message>` 标签剥离）
   - `src/policy.ts`（概率/长度/冷却/群聊，`isShared` 用 scope.type）
   - `src/sender.ts`（record/audio，`file://` src 触发 assets）
   - `src/index.ts`（Schema + `inject: ['yesimbot']` 必选）
2. 单测 22 条全绿（text-extract 6 / policy 9 / tts-client 7）+ typecheck + build
3. 真实 TTS e2e 验证：4859 音色 + 中英混排 ≈ 6-11s 合成，WAV 有效（24kHz mono）
4. GitHub 仓库 + 全部提交已 push（含 dist，NAS 免 build 部署）
5. NAS 部署：node_modules 放置 + koishi.yml 配置 + 音色文件
6. **插件在 mita_koishi 加载注册成功**（`aka-yesimbot-voice registered platforms=onebot`）
7. **onTurnFinish 链路验证**：日志出现 `voice candidate` → TTS 合成 → `voice sent`（Koishi 侧成功）

## 当前卡点 🔴（下次会话优先）

**语音发送到 QQ 群不成功**：Koishi `bot.sendMessage(record)` 返回成功（`voice sent` 日志），但 **NapCat 侧无任何记录，群里看不到语音**。已尝试：
1. record src 裸路径 `/koishi/data/...` → 失败（NapCat 容器读不到 Koishi 容器路径）
2. koishi.yml 配 `assets-local selfUrl: http://koishi:5140` → 仍失败
3. record src `file://` 前缀（触发 Koishi assets）→ **刚部署，未验证**（18:05 部署，18:08 又被另一个 agent 重启覆盖了测试环境）

下一步候选方案（未试）：
- **方案 A（推荐）**：插件 sender 直接调 **NapCat HTTP API**（`http://mita_napcat:6199/send_group_msg`，同 docker 网络可达）——wav 转 base64 或复制到 NapCat 可读路径（ntqq 卷 `/app/.config/QQ/`），record CQ 码发送。这是之前 Mita 手动发语音的已验证路径（get_msg 复核过）
- 方案 B：查 Koishi onebot 适配器对 record 的处理（是否真走了 assets / file:// 转换），配公网 selfUrl
- 验证目标：`get_msg` 复核 message_id + record 类型 + 群号

## 部署/调试备忘

- 部署：git push → NAS `docker exec mita_koishi wget tarball` → 复制 dist/package.json 到 `/koishi/node_modules/koishi-plugin-aka-yesimbot-voice/` → `docker restart mita_koishi`
- koishi.yml 插件块：`group:1zgb8f` 下 `aka-yesimbot-voice:25yasi`（probability 1.0 测试值，**验证后调回 0.2**）
- 音色：NAS `/koishi/data/aka-yesimbot-voice/voice-4859.wav`（1.3MB）；源 Mac `/tmp/voices/ai_news_4859.wav`
- TTS：`http://100.121.167.1:50000/inference_instruct2`，`prompt_wav` 必填 + `instruct_text` 必带 `<|endofprompt|>`（缺 → 服务端 AssertionError → HTTP 200 空体）
- 测试群：**463029480**（yesimbot allowedChannels 第一项）
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
| record 裸路径 NapCat 读不到 | 尝试 file:// + assets（未验证） |

## 外部干扰

- **另一个 agent 在频繁调试 yesimbot**（改 dist temperature、加 MITA-DEBUG 日志、装 music-voice 插件、反复重启 mita_koishi）——测试会互相干扰，确认环境稳定后再验证
- yesimbot 启动警告：`Ignoring models.json chat default "deepseek:deepseek-v4-flash" because it is not a registered chat model`（可能影响回复，另一个 agent 处理中）
- 群 463029480 的 turn 曾卡死在工具调用（sticker_search 等），onTurnFinish 需 turn 完成才触发
