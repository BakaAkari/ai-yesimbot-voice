# koishi-plugin-aka-yesimbot-voice

YesImBot v4 语音组件：bot 的回复经 **NAS CosyVoice3 TTS** 合成语音，通过 **NapCat HTTP API** 直发 QQ 群语音。

```
群友 → @bot → yesimbot(主模型) 产出回复文本
   ↓
plugin 策略判定（概率/长度/冷却/群聊/force-voice）
   ↓
音色 = settings.json 唯一真源 → zero_shot 合成（CosyVoice3 :50000 /inference_zero_shot）
   ↓
NapCat HTTP API 直发（base64:// record，自动转 amr 上传 QQ CDN）
   ↓
群内收到语音
```

---

## 功能特性

- **语音发送**：回复文本 → 策略判定 → TTS 合成 → QQ 群语音直发。
- **文本替换（可选）**：`replaceText: true` 时命中语音的回复**不发文本、只发语音**；TTS 失败自动补发文本兜底。
- **zero_shot 音色**：音色 = `voiceDir/<音色名>.wav` + 同名 `<音色名>.txt`（参考音频及**真实转写**），合成时转写作为 `prompt_text` 传 `/inference_zero_shot` 做语音条件对齐。更新音源 = 覆盖这两个文件，自包含、不依赖外部音色库路径。
- **语音按需（use_voice）**：给 yesimbot LLM 注册 `use_voice` 工具，米塔想用语音「喊话/强调/应群友要求」时主动调用，本轮回复 100% 走语音。
- **音色唯一真源**：当前音色只存于 `data/aka-yesimbot-voice/settings.json`，用 `.voice` 命令切换（`.voice` 查看列表，`.voice <音色名>` 切换），重启不丢。

---

## 前置依赖

运行这个插件需要先就位三样东西：

1. **NAS 上的 CosyVoice3 TTS 服务**（合成引擎，见下节「部署 TTS 系统」）
2. **yesimbot**（Koishi 里的 YesImBot 主体，负责对话 + 调用 `use_voice`）
3. **NapCat HTTP API**（QQ 语音直发通道，默认 `http://mita_napcat:6199`）

---

## 部署我们用的这套 TTS 系统（CosyVoice3）

本插件的合成引擎是 **CosyVoice3**（`Fun-CosyVoice3-0.5B-2512`，0.5B 双语/跨语言 zero-shot TTS），以 Docker 方式跑在 NAS 上，宿主导出 **50000** 端口。

### 部署（Docker）

```sh
# 拉取/构建 CosyVoice3 镜像，挂载模型与补丁，暴露 50000
docker run -d --name ai-cosyvoice3 \
  -p 50000:50000 \
  -v /你的路径/Fun-CosyVoice3-0.5B-2512:/opt/CosyVoice/pretrained_models \
  -v /你的路径/llm.py:/opt/CosyVoice/CosyVoice/cosyvoice/llm/llm.py:ro \
  <cosyvoice3-image>
```

容器内跑 `cosyvoice3_server.py`，暴露 HTTP 服务端点。核心契约（zero_shot）：

```
POST /inference_zero_shot
  tts_text  合成正文
  prompt_text  参考音频(prompt_wav) 的「真实转写」——不是朗读指令
  prompt_wav  参考音频（决定音色）
  speed      语速
```

> 服务端会自动补 `<|endofprompt|>` 后缀；调用方把朗读指令填进 `prompt_text` 会被当正文念出来。

### 已知上游坑（部署时注意）

- **短文本合成崩**：上游 `llm.py` 在 `min_len` 内遇到 stop token 会无条件 break，导致短文本（<100 字）合成崩溃。需打一个 **v4 patch**（`min_len` 内遇 stop token 屏蔽 `sid` 后重采样 `self.sampling_ids(...)`，`i >= min_len` 才 break）。该补丁以只读挂载进容器。
- **长文本英文发音指导**：可对长文本走规则/LLM 改写层提升英文词发音（见插件 `llm` 开关）。

### 「训练」说明

本系统的**定制音色不需要训练**——zero_shot 用一段「参考音频 + 转写」即可克隆目标说话人（`prompt_wav` 决定音色、`prompt_text` 做语音条件对齐）。真正对 CosyVoice3 底座做 fine-tune 不属于本插件常规用法，一般也不需要。

---

## 安装

Koishi 市场搜索安装 `koishi-plugin-aka-yesimbot-voice`，或：

```sh
npm i koishi-plugin-aka-yesimbot-voice
```

---

## 配置项（对齐当前 schema）

| 键 | 默认 | 说明 |
|---|---|---|
| `hint` | — | 设置页顶部说明（纯展示，不参与业务） |
| `probability` | `1.0` | 每条回复配语音概率（0-1） |
| `llm` | `true` | LLM 语音效果渲染（走 yesimbot 主模型改写朗读文本；失败自动降级规则层） |
| `voiceDir` | `data/aka-yesimbot-voice/voices` | 音色源目录：放/删 `*.wav`(+同名 `.txt`) 即增删音色，重启生效 |
| `advanced.ttsApiBase` | `http://100.121.167.1:50000` | CosyVoice3 服务地址 |
| `advanced.ttsTimeoutMs` | `30000` | 合成超时 ms（1000-120000） |
| `advanced.minLength` | `4` | 最短触发文本长度（字符） |
| `advanced.maxLength` | `120` | 最长触发文本长度（字符），超过不配（避免长文朗读） |
| `advanced.cooldownSeconds` | `60` | 同渠道冷却秒 |
| `advanced.groupOnly` | `true` | 仅群聊配语音 |
| `advanced.onMentionOnly` | `false` | 仅被 @ 时配语音 |
| `advanced.replaceText` | `true` | 命中语音时吞掉文本回复、只发语音（TTS 失败补发文本） |
| `advanced.napcatHttpUrl` | `http://mita_napcat:6199` | NapCat HTTP API（QQ 语音直发） |

> 当前音色**不在本配置页设置**，由 `.voice` 命令写入 `settings.json`（唯一真源）。

---

## 音色文件设计指南（重点）

每个音色是两个文件的组合：

```
voiceDir/
  mabaoguo.wav      # 参考音频（决定音色）
  mabaoguo.txt      # 该音频的「真实转写」（决定语音条件对齐）
```

### 原理

CosyVoice3 zero_shot 用 `prompt_wav`（参考音频）确定说话人音色，用 `prompt_text`（转写）做语音对齐。**音色≈你给的那段参考音频**；参考音频像不像、干不干净，直接决定成品的像真度。

### 一份高质量参考音频怎么做

1. **清晰、单一说话人**：只听这个目标音色本人；不要第二人声、不要 BGM/混响/设备底噪。
2. **长度合适**：建议 10-30 秒，太短音色信息不足、太长引入冗余。
3. **内容有代表性**：尽量覆盖目标语言的主要音素、语调和常见句式；中英混用的话，转写里也保留英文段。
4. **`txt` 必须与音频逐字一致**：是**真实转写**（含语气词、停顿），不是朗读指令——把指令填进去会被当作正文念出来。
5. **节奏/换气**：想让成品更自然，参考音频里保留自然停顿；句间停顿主要靠规范标点控制（`[breath]` 等韵律标记位置与时长不可控，最稳的是规范标点）。

### 选音色的小技巧（年轻女声）

若目标是年轻女声，可用 `librosa.pyin` 统计参考音频的基频（F0）中位数——**F0 250-310Hz** 区间通常是年轻女声；同时看时长 ≥4.5s、RMS 平稳。

### 版权注意

- 公开/商用前确认音色来源合法。
- 游戏/动漫角色语音（原神、方舟等）**不可**用于公开视频配音（官方禁止 AI 克隆角色语音）。
- 合规可用的开源中文音色：**AISHELL-3**（Apache 2.0，录音棚品质）、**Common Voice**（CC0 公共领域）。

### 更新 / 增删

- **新增**：放入 `<名字>.wav` + `<名字>.txt`，重启后自动出现。
- **切换**：`.voice <名字>`（写 settings.json，即时生效）。
- **替换音源**：覆盖同名 `.wav` / `.txt`，重启生效。

---

## 发送链路（QQ 语音）

QQ 语音**必须**配置 `advanced.napcatHttpUrl` 指向 NapCat HTTP API：

- onebot 适配器下 `bot.sendMessage(record)` 是「假成功」（NapCat 侧无记录、群内看不到）。
- 插件改为直调 `POST {napcatHttpUrl}/send_group_msg`，WAV 转 `base64://` record，NapCat 自动转码 amr 上传 QQ CDN。
- 同 Docker 网络用容器名：`http://mita_napcat:6199`；`napcatHttpUrl` 留空则回退 Koishi 元素发送（本地开发用）。

---

## 开发 / 发布

```sh
pnpm typecheck
pnpm build      # tsup 编译 dist（npm publish 时 prepublishOnly 自动执行）
pnpm test
```

发布由仓库根 `./push.sh <plugin-dir-name>` 手动触发（版本号变更、tag、npm publish 是用户控制的门禁）。

---

## 排障速查

- **只收到文字、没有语音**：查是否触发了「热重载后语音失效」的旧 bug（v0.6.3 已修，运行时状态已挂到 bot 对象上）。升级到最新版并重载。
- **`use_voice tool invoked` 但无语音**：确认 `replaceText` 开启、`advanced.napcatHttpUrl` 可达、TTS 服务 `:50000` 正常。
- **语音是假成功/群内看不到**：确认走的是 NapCat HTTP API 直发，而不是 onebot 的 `record` 元素。
- **音色不对**：核查 `settings.json` 唯一真源 + `voiceDir` 下 wav/txt 是否齐全；`.voice` 切换后合成用 settings.json 最新值。
