# koishi-plugin-aka-yesimbot-voice

YesImBot v4 语音组件：bot 回复经 NAS CosyVoice3 TTS 合成语音，发送到 QQ 群。

## 功能

- **语音发送**：bot 回复 → 文本提取 → 策略判定（概率/长度/冷却/群聊）→ TTS 合成（CosyVoice3 instruct2）→ NapCat HTTP API 直发 QQ 群语音
- **文本替换（可选）**：`replaceText: true` 时，命中语音策略的回复**不发送文本，只发语音**；TTS 失败自动补发文本兜底
- **中英混排**：NAS CosyVoice3 服务端已做短文本 instruct 降级修复（<110 字自动 bare 指令，不念出朗读指令），长文本保留英文发音指导

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `ttsEnabled` | `true` | 总开关 |
| `platforms` | `['onebot']` | 生效平台（onebot / lark） |
| `ttsApiBase` | `http://127.0.0.1:50000` | CosyVoice3 服务地址（NAS `http://100.121.167.1:50000`） |
| `voicePromptPath` | `''` | 音色 prompt_wav 本地路径（空 = 服务端默认音色） |
| `instructText` | 中英混排朗读指令 | 朗读指令（服务端会对短文本自动降级为 bare） |
| `probability` | `0.2` | 每条回复配语音概率 |
| `minLength` / `maxLength` | `8` / `120` | 文本长度范围才配语音 |
| `cooldownSeconds` | `120` | 同渠道冷却秒 |
| `groupOnly` | `true` | 仅群聊配语音 |
| `napcatHttpUrl` | `''` | NapCat HTTP API 地址（QQ 语音直发，如 `http://mita_napcat:6199`）；留空回退 Koishi 元素发送（本地开发） |
| `replaceText` | `false` | 命中语音时吞掉文本回复，只发语音 |

## 发送链路（重要）

QQ 语音**必须**配置 `napcatHttpUrl`（NapCat HTTP API）：
- Koishi `bot.sendMessage(record)` 在 onebot 适配器下是**假成功**（NapCat 侧无记录，群内看不到）
- 插件改为直调 `POST {napcatHttpUrl}/send_group_msg`，WAV 转 `base64://` record，NapCat 自动转码 amr 上传 QQ CDN
- 同 docker 网络用容器名：`http://mita_napcat:6199`

## Scripts

```sh
pnpm build
pnpm typecheck
pnpm test
```

## Publish

Publish from the repository root with the workspace release script. This is a manual user action, not an automatic LLM action.

```sh
./push.sh <plugin-dir-name>
```
