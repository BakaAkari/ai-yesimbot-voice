# aka-yesimbot-voice — 音色库 + 配置极简化 设计方案 (v0.3.0)

> 目标:让插件使用 NAS 训练好的多音色库,**管理员可增删音源、手动选择音色给 bot 用**;同时把 17 个可配置项收敛到极简,默认值能不动就不暴露。

## 1. 音色源目录(唯一增删入口)

**约定目录**:`<outputDir>/voices/`(默认 `data/aka-yesimbot-voice/voices/`,即 Koishi 数据目录下,可持续化,不会因容器重启丢失)。

- 每个音色 = 一个 `<voiceName>.wav`(文件名不含扩展名即音色名,如 `leijun.wav`、`yuchengdong.wav`、`gs_Collei.wav`)
- 可选同名 `<voiceName>.txt`(参考转写,供后续 LLM 层用;没有也没关系)
- **管理员增音源** = 往该目录放一个 wav; **删音源** = 删除对应 wav → 重启插件生效
- 插件启动时扫描该目录,构建 `name → 绝对路径` 注册表,并对**缺失文件做防御性跳过**(空壳/损坏不崩)

**初始库预置**:把 NAS `/mnt/user/appdata/hermes/tts_sources/voices/` 里 30 个有真实 `ref.wav` 的音色,按规范命名拷贝进容器该目录作为初始音色库(默认雷军)。

**命名映射**(ref.wav → voices 目录):
- 人物:`leijun` → `leijun.wav`, `yuchengdong` → `yuchengdong.wav`, `dingzhen`/`luoxiang`/`mabaoguo`/`sunxiaochuan`/`tangguoqiang`/`heishou`/`geping`/`dalige`/`dailanzi`/`henanguinv`/`liuhuaqiang`/`qiegewala`/`yaoshuige`
- 原神:`gs_Collei`→`gs_Collei.wav` 等 9 个
- 蔚蓝档案:`ba_arisu`→`ba_arisu.wav` 等 5 个
- 日系:`taffy`→`taffy.wav`

## 2. 音色选择(管理员手动选一种给 bot)

**全局一个 `voice` 配置**(默认 `'auto'`):
- `auto` = 目录里按字母序取第一个
- 具体名(如 `leijun`) = 用指定音色;名字不存在 → 回退 auto 并告警日志
- **音色切换持久化**:命令改的 config 写回,重启不丢

**人人可用的管理员指令**(降低进场成本,不用进控制台翻配置):
- `.voice list` — 列出目录里所有可用音色
- `.voice <name>` — 切换到指定音色(仅 admin 可执行,写回配置持久化)

管理员在 Koishi 控制台里也能直接改 `voice` 字符串字段。

## 3. 配置极简化(17 项 → 基础 3 + 高级隐藏一堆)

**基础(可见,管理员常碰)**:
| 配置 | 默认 | 说明 |
|---|---|---|
| `voice` | `auto` | 当前音色(管理员选择) |
| `probability` | 0.85 | 语音触发概率(体验相关) |
| `llm.enabled` | true | LLM 语音渲染开关(v0.2.0) |

**高级(默认隐藏,Koishi 控制台折叠,能不动就不动)**:
`ttsApiBase`(默认 NAS :50000)、`instructText`、`ttsTimeoutMs`、`outputDir`、`minLength`、`maxLength`、`cooldownSeconds`、`groupOnly`、`onMentionOnly`、`platforms`、`replaceText`、`logFailures`、`napcatHttpUrl`

实现:用 Koishi `Schema.object` 内嵌一个 `advanced` 组,控制台折叠隐藏;实现阶段验证 `.hidden()` / 嵌套分组的实际渲染,不破坏现有语义(旧 config 仍兼容)。

## 4. 实现范围与验证

- 新增 `voices.ts`(目录扫描 + 注册表 + 名字校验)
- `index.ts`: `voice` 解析逻辑、`.voice` 命令、advanced 分组重构
- 单测:音色目录扫描(跳过空壳)、voice 选择规则(auto/具名/缺失回退)、命令权限
- 本地:typecheck / 单测 / build 全绿
- NAS 部署:拷贝 30 个音色进容器 voices 目录 + 部署新 dist;启动日志确认注册表加载 + 默认雷军
- Kari 手动验收:`.voice list` 列出、`.voice gs_Collei` 切换后触发语音听效果

## 5. 不影响项
- 不升版本号(在 v0.2.0 开发线继续,验收后再谈版本)
- 不 git push / 不发布(版本与发布由 Kari 授权)
