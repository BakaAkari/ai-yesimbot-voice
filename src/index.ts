import { Context, Schema, Logger, type Bot } from 'koishi'
import { join, dirname, isAbsolute } from 'node:path'
import type { AgentPlugin, TurnResult } from '@yesimbot/agent-runtime'
import { TtsClient, type TtsClientConfig } from './tts-client.js'
import { extractReplyText } from './text-extract.js'
import { decide, type TtsPolicyConfig } from './policy.js'
import { sendVoice } from './sender.js'
import { render, type RenderOptions } from './preprocess.js'
import { fromYesimbot, type LlmChannel } from './llm-channel.js'
import { VoiceLibrary, type VoiceInfo } from './voices.js'

const DEFAULT_LLM_PROMPT = `你是专业的声音导演。把下面的对话回复改写成\"朗读友好文本\"，交给 CosyVoice 合成语音。
要求：
1. 保留原意与信息，不得增删事实、不得改人称/数字/专有名词
2. 按语义意群拆句：把长句在谓词/并列/连词处拆成几个短句（每句一个完整信息块），并保证每句结尾有终止标点（句号/问号/感叹号）；不要把一个信息块硬切成碎片
3. 加入自然的口语节奏：适当断句、停顿提示、语气词（嗯、啊、哈），增强情绪表达
4. 不要插入任何方括号标记（如 [breath] 等会被丢弃）
5. 标点规范化：句末必须有句号/问号/感叹号；逗号表示短停顿，句号表示长停顿
6. 英文单词保持原样，前后加空格；数字按自然读法改写（如 3.5 → 三点五）
7. 只输出改写后的文本本身，不要解释、不要引号、不要 markdown
8. 输出长度与原文本相当（±30%），不得扩写

原文：
{text}`

/**
 * 按当前音色把 CV3 的 persona/朗读风格注入 LLM 改写 prompt。
 * 有 stylePrompt 时在「原文」前插入一段朗读风格参考（贴合音色，但禁止改原意字面内容）；
 * 无则退回基础 prompt。
 */
function composeVoicePrompt(stylePrompt?: string): string {
  if (!stylePrompt) return DEFAULT_LLM_PROMPT
  return DEFAULT_LLM_PROMPT.replace(
    '\n原文：\n{text}',
    `\n朗读风格（贴合当前音色，但严禁增删或改变原意的字面内容，只微调语气与措辞）：\n${stylePrompt}\n\n原文：\n{text}`,
  )
}

export const name = 'aka-yesimbot-voice'

/** 依赖 yesimbot service（必选：Koishi 保证在 yesimbot 注册后加载本插件） */
export const inject = ['yesimbot']

/**
 * 极简配置模型（v0.3.0 重构，无旧字段兼容负担）。
 * - 基础：音色、触发概率、LLM 渲染开关、音色源目录
 * - advanced：不常改的默认值折叠隐藏
 */
export interface Config {
  /** 设置页顶部说明（纯信息，不参与运行业务） */
  hint: object
  /** 每条回复配语音概率 0-1 */
  probability: number
  /** LLM 语音效果渲染（走 yesimbot 主模型通道；失败自动降级规则层） */
  llm: boolean
  /** 音色源目录：管理员放/删 *.wav 即增删音色（重启生效） */
  voiceDir: string

  advanced: {
    /** CosyVoice3 服务地址 */
    ttsApiBase: string
    /** 合成超时 ms */
    ttsTimeoutMs: number
    /** 最短触发文本长度（字符） */
    minLength: number
    /** 最长触发文本长度（字符），超过不配（避免长文朗读） */
    maxLength: number
    /** 同渠道冷却秒 */
    cooldownSeconds: number
    /** 仅群聊配语音 */
    groupOnly: boolean
    /** 仅被 @ 时配语音 */
    onMentionOnly: boolean
    /** 命中时吞掉 yesimbot 文本只发语音（TTS 失败自动补发文本） */
    replaceText: boolean
    /** NapCat HTTP API（QQ 语音直发） */
    napcatHttpUrl: string
    /** 合成语速（CV3 规范推荐 1.2；1.0 偏慢、1.3 偏快） */
    ttsSpeed: number
    /** 合成后做响度归一化到 -20 LUFS（走服务端 /loudnorm；端点不可用自动跳过） */
    loudnorm: boolean
    /** 合成 WAV 末尾追加静音 ms（防 QQ Silk 帧编码吞掉末音节，默认 400） */
    ttsTailPadMs: number
  }
}

export const Config: Schema<Config> = Schema.object({
  hint: Schema.object({}).description(
    '把 bot 的回复转成语音发到 QQ 群。\n\n■ 音色文件\n音色目录：data/aka-yesimbot-voice/voices（下方 voiceDir）\n每个音色 = <音色名>.wav（参考音频）+ 同名 <音色名>.txt（该音频的真实转写）\n放入即新增，重启后自动可用。\n\n■ 当前音色\n唯一真源 = data/aka-yesimbot-voice/settings.json\n用 .voice 命令切换：.voice 查看列表，.voice <音色名> 切换\n本配置页不设置音色。',
  ),
  probability: Schema.number().min(0).max(1).default(1.0).description('每条回复配语音概率'),
  llm: Schema.boolean().default(true).description('LLM 语音效果渲染（走 yesimbot 主模型；失败自动降级规则层）'),
  voiceDir: Schema.string().default('data/aka-yesimbot-voice/voices').description('音色源目录：往里放/删 *.wav 即增删音色（重启生效）'),

  advanced: Schema.object({
    ttsApiBase: Schema.string().default('http://100.121.167.1:50000').description('CosyVoice3 服务地址'),
    ttsTimeoutMs: Schema.number().min(1000).max(120000).default(30000).description('合成超时 ms'),
    minLength: Schema.number().min(0).default(4).description('最短触发文本长度（字符）'),
    maxLength: Schema.number().min(0).default(120).description('最长触发文本长度（字符）'),
    cooldownSeconds: Schema.number().min(0).default(60).description('同渠道冷却秒'),
    groupOnly: Schema.boolean().default(true).description('仅群聊配语音'),
    onMentionOnly: Schema.boolean().default(false).description('仅被 @ 时配语音'),
    replaceText: Schema.boolean().default(true).description('命中时吞掉 yesimbot 文本只发语音（TTS 失败自动补发文本）'),
    napcatHttpUrl: Schema.string().default('http://mita_napcat:6199').description('NapCat HTTP API（QQ 语音直发）'),
    ttsSpeed: Schema.number().min(0.5).max(2).step(0.05).default(1.2).description('合成语速（CV3 规范推荐 1.2；1.0 偏慢、1.3 偏快）'),
    loudnorm: Schema.boolean().default(true).description('合成后做响度归一化到 -20 LUFS（走服务端 /loudnorm；端点不可用自动跳过）'),
    ttsTailPadMs: Schema.number().min(0).max(2000).default(400).description('合成 WAV 末尾追加静音 ms（防 QQ Silk 帧编码吞掉末音节；0=不填充）'),
  }).description('高级设置（一般不用动）'),
})

export function apply(ctx: Context, config: Config) {
  const logger: Logger = ctx.logger('aka-yesimbot-voice')
  const adv = config.advanced
  const tts = new TtsClient({
    apiBase: adv.ttsApiBase,
    timeoutMs: adv.ttsTimeoutMs,
    tailPadMs: adv.ttsTailPadMs,
    speed: adv.ttsSpeed,
    loudnorm: adv.loudnorm,
  } satisfies TtsClientConfig)

  // 音色库：volatile 生命周期内每次解析都重新扫描目录（放/删音色重启生效）
  const absVoiceDir = resolveVoiceDir(ctx, config.voiceDir)
  const outputDir = outputDirOf(absVoiceDir)
  const voices = new VoiceLibrary(absVoiceDir)

  // 当前音色持久化（settings.json 唯一真源，重启不丢）
  const settingsPath = join(dirname(absVoiceDir), 'settings.json')
  function readSavedVoice(): string | undefined {
    try {
      const { readFileSync } = require('node:fs') as typeof import('node:fs')
      const data = JSON.parse(readFileSync(settingsPath, 'utf8')) as { voice?: string }
      if (typeof data.voice === 'string' && data.voice) return data.voice
    } catch { /* 无或损坏 */ }
    return undefined
  }
  function saveVoice(name: string): void {
    try {
      const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
      mkdirSync(dirname(settingsPath), { recursive: true })
      writeFileSync(settingsPath, JSON.stringify({ voice: name }, null, 2), 'utf8')
    } catch (err) {
      logger.warn('save voice settings failed: %s', err instanceof Error ? err.message : String(err))
    }
  }
  // 当前音色唯一真源 = settings.json（每次现读磁盘）。
  // 移除 config.voice 后不再有「配置页 vs settings」双真源：.voice 命令写 settings，
  // 合成每次从 settings.json 取最新；无 settings 时回退 'auto'（音色目录第一个）。
  function resolveCurrentVoice(): string {
    const saved = readSavedVoice()
    if (saved) return saved
    return 'auto'
  }

  // 语音效果渲染通道（llm=false → 只跑规则层；yesimbot 通道构建失败自动降级规则层）
  let llmChannel: LlmChannel | null = null
  if (config.llm) {
    llmChannel = fromYesimbot(ctx, { logger })
    if (!llmChannel) logger.warn('llm channel yesimbot unavailable — falling back to rules')
  }
  const renderOpts: RenderOptions = {
    llm: llmChannel,
    fidelityRatio: 0.95,
    // zero_shot 下 [breath] 等韵律标记会导致模型提前截断→音频不完整，关闭注入（最终文本还会统一剥除标记）
    injectBreath: false,
    timeoutMs: 60000,
    prompt: DEFAULT_LLM_PROMPT,
    logPrompts: false,
    logger,
  }
  async function renderVoice(text: string) {
    const voice = currentVoice()
    // 按当前音色把 CV3 persona/朗读风格注入 LLM 改写层（无 stylePrompt 时退回基础 prompt）
    const prompt = composeVoicePrompt(voice?.stylePrompt)
    return render(text, { ...renderOpts, prompt })
  }

  const policyCfg: TtsPolicyConfig = {
    ttsEnabled: true,
    probability: config.probability,
    minLength: adv.minLength,
    maxLength: adv.maxLength,
    cooldownSeconds: adv.cooldownSeconds,
    groupOnly: adv.groupOnly,
    onMentionOnly: adv.onMentionOnly,
  }

  // —— replaceText 模式 ——
  const FORCE_VOICE_TTL = 120_000
  // 运行时语音状态统一挂到 bot 对象上，与插件 apply() 实例生命周期解耦。
  // 背景：热重载会新建 apply() 与它捕获的闭包，但 bot 对象不重建、且 _akaVoicePatched
  // 阻止了重新 patch。若状态留在 apply() 里，重载后 sendMessage patch（旧实例闭包）读的是旧
  // map，而新实例的 use_voice/onAppend 写新 map，二者永远脱节 → force-voice / 吞文本静默失效、
  // 回复以纯文本漏发。挂到 bot 上让所有实例读写同一份状态。
  interface VoiceRuntimeState {
    pendingVoice: Map<string, { text: string; timer: ReturnType<typeof setTimeout>; consumed: boolean }>
    turnSegments: Map<string, string[]>
    forceVoiceChannels: Map<string, number>
    lastSpeakAt: Map<string, number>
  }
  function voiceState(bot: Bot): VoiceRuntimeState {
    const b = bot as unknown as { _akaVoiceState?: VoiceRuntimeState }
    return (b._akaVoiceState ??= {
      pendingVoice: new Map(),
      turnSegments: new Map(),
      forceVoiceChannels: new Map(),
      lastSpeakAt: new Map(),
    })
  }
  function isForceArmed(st: VoiceRuntimeState, channelId: string): boolean {
    const exp = st.forceVoiceChannels.get(channelId)
    if (exp === undefined) return false
    if (Date.now() > exp) {
      st.forceVoiceChannels.delete(channelId)
      return false
    }
    return true
  }

  /** 解析当前音色（auto/具名，含参考音频路径 + 转写）；目录无音色返回 null */
  function currentVoice(): VoiceInfo | null {
    const requested = resolveCurrentVoice()
    const voice = voices.resolve(requested)
    const resolved = voice?.name ?? null
    // 具名音色请求却解析到别的音色（通常=排序第一即 halo_marine）→ 必是配置/扫描异常，显式告警，不再静默
    if (requested && requested !== 'auto' && requested !== resolved) {
      logger.warn(
        'voice resolve MISMATCH: requested=%s resolved=%s (fallback) — check settings.json / voiceDir files',
        requested, resolved,
      )
    }
    return voice
  }

  function consumePending(channelId: string, bot: Bot, platform: string): void {
    const st = voiceState(bot)
    const item = st.pendingVoice.get(channelId)
    if (!item || item.consumed) return
    item.consumed = true
    if (item.timer) clearTimeout(item.timer)
    st.pendingVoice.delete(channelId)
    const text = item.text
    void (async () => {
      try {
        const rendered = await renderVoice(text)
        const voice = currentVoice()
        const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, voice ?? undefined)
        await sendVoice(bot, channelId, out.wavPath, platform, adv.napcatHttpUrl)
        st.lastSpeakAt.set(channelId, Date.now())
        logger.info(
          'voice sent (text replaced) channel=%s voice=%s path=%s len=%d dur=%dms source=%s ratio=%s degraded=%s loudnorm=%s%s rendered=%s',
          channelId, voice?.name ?? 'none', voice?.path ?? '', out.pcmBytes, out.durationMs, rendered.source,
          rendered.ratio.toFixed(3), rendered.degraded, String(out.loudnormApplied ?? false),
          rendered.reason ? ` reason=${rendered.reason}` : '', rendered.text.slice(0, 40),
        )
      } catch (err) {
        // TTS/发送失败：补发文本，保证回复不丢
        logger.warn('voice failed, fallback text channel=%s: %s', channelId, err instanceof Error ? err.message : String(err))
        try {
          await bot.sendMessage(channelId, text)
          logger.info('fallback text sent channel=%s', channelId)
        } catch (fallbackErr) {
          logger.warn('fallback text also failed channel=%s: %s', channelId, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
        }
      }
    })()
  }

  function queuePending(bot: Bot, channelId: string, platform: string, text: string): void {
    const st = voiceState(bot)
    const existing = st.pendingVoice.get(channelId)
    if (existing && !existing.consumed) {
      // 同 turn 多段：合并文本，重置防抖
      existing.text = existing.text.length > text.length ? existing.text : text
      if (existing.timer) clearTimeout(existing.timer)
      existing.timer = setTimeout(() => consumePending(channelId, bot, platform), 600)
      return
    }
    const timer = setTimeout(() => consumePending(channelId, bot, platform), 600)
    st.pendingVoice.set(channelId, { text, timer, consumed: false })
  }

  // 从 sendMessage 的 content 里提取纯文本（h 元素数组 / 字符串）
  function extractSendText(content: unknown): string {
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((seg) => {
          if (typeof seg === 'string') return seg
          if (seg && typeof seg === 'object') {
            const s = seg as { type?: string; attrs?: { content?: string; text?: string }; children?: unknown[] }
            if (s.attrs?.content) return s.attrs.content
            if (s.attrs?.text) return s.attrs.text
            if (Array.isArray(s.children)) return s.children.map((c) => (typeof c === 'string' ? c : '')).join('')
          }
          return ''
        })
        .join('')
        .trim()
    }
    return ''
  }

  // 从 assistant content 提取 <message> 段（保留标签边界）
  function extractTurnSegments(content: unknown): string[] {
    const text = (() => {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .filter((p) => p && typeof p === 'object' && (p as { type?: string }).type === 'text')
          .map((p) => ((p as { text?: unknown }).text ?? '') as string)
          .join('\n')
      }
      return ''
    })()
    if (!text) return []
    return text
      .split(/<message\s*\/?\s*>/)
      .map((s) => s.replace(/<\/message>/g, '').trim())
      .filter(Boolean)
  }

  // —— .voice 指令：管理员列/切换音色（单命令，可选参数 [name]；.voice 查看 / .voice <name> 切换） ——
  ctx.command('voice [name]', '语音设置：.voice 查看当前/全部音色；.voice <音色名> 切换')
    .action(async ({ session }, name) => {
      if (!session) return '需要会话上下文。'
      const list = voices.scan()
      if (!name) {
        const current = voices.resolve(resolveCurrentVoice())
        if (!list.length) return '音色目录为空：往 voiceDir 放入 *.wav（重启生效）。'
        const lines = list.map((v) => `${v.name === current?.name ? '● ' : '○ '}${v.name}`).join('\n')
        return `当前音色：${current?.name ?? '（无）'}\n可用音色：\n${lines}\n\n用 .voice <音色名> 切换`
      }
      const found = list.find((v) => v.name === name)
      if (!found) return `没有音色「${name}」。用 .voice 查看可用列表。`
      // 写 settings.json 即即时生效：resolveCurrentVoice 每次现读磁盘，无需内存缓存
      saveVoice(name)
      logger.info('voice switched to %s by user', name)
      return `✅ 已切换到音色「${name}」（已保存，重启不丢）。`
    })

  // —— .说 指令：说<内容> → 用当前音色直接说出该内容（走 sound-director LLM 改写）——
  // 无内容 → 静默取消（不触发 TTS、不提示）。
  ctx.command('说 [text:text]', '说 <内容>：用当前音色直接说出该内容')
    .action(async ({ session }, text) => {
      if (!session) return
      const content = (text ?? '').trim()
      if (!content) return // 静默取消
      const cid = String(session.channelId ?? session.cid ?? '')
      const bot = session.bot
      const platform = session.platform
      if (!cid || !bot) return
      void (async () => {
        try {
          const rendered = await renderVoice(content)
          const voice = currentVoice()
          if (!voice) {
            logger.warn('说: no voice configured, no-op channel=%s', cid)
            return
          }
          const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, voice)
          await sendVoice(bot, cid, out.wavPath, platform, adv.napcatHttpUrl)
          logger.info(
            '说 direct speak channel=%s voice=%s len=%d dur=%dms source=%s ratio=%s loudnorm=%s',
            cid, voice.name, out.pcmBytes, out.durationMs, rendered.source,
            rendered.ratio.toFixed(3), String(out.loudnormApplied ?? false),
          )
        } catch (err) {
          logger.warn('说 direct speak failed channel=%s: %s', cid, err instanceof Error ? err.message : String(err))
        }
      })()
      return // 成功静默（语音即回复）
    })

  const yesimbot = (ctx as any).yesimbot
  if (!yesimbot?.registerChannelPlugin) {
    logger.warn('yesimbot service unavailable — plugin inactive')
    return
  }
  yesimbot.registerChannelPlugin(({ bot, scope }: any) => {
    const channelId: string = scope.channelId
    const platform: string = scope.platform
    const isShared: boolean = scope.type === 'shared'

    // replaceText 模式：patch 发送出口（每 bot 只 patch 一次）。
    // 只吞"发送文本 == 本 channel 最近 turn 的某个 <message> 段"的调用：
    //   - yesimbot 回复段 → 匹配 → 策略判定后吞（只发语音）
    //   - 指令返回 / 其他插件发送 → 文本不在段列表 → 永不吞
    if (adv.replaceText && platform === 'onebot' && !(bot as any)._akaVoicePatched) {
      ;(bot as any)._akaVoicePatched = true
      const origSend = bot.sendMessage.bind(bot)
      bot.sendMessage = (async (cid: string, content: unknown, ...rest: unknown[]) => {
        const text = extractSendText(content)
        const cidStr = String(cid)
        const st = voiceState(bot)
        if (text && isShared && !st.pendingVoice.has(cidStr)) {
          const segments = st.turnSegments.get(cidStr) ?? []
          const isTurnReply = segments.includes(text)
          const forced = isForceArmed(st, cidStr) // 校验且在有效期
          // force-voice 优先：.说话 后本群下一条 bot 发送即强制语音（不依赖 isTurnReply）
          if (forced) {
            st.forceVoiceChannels.delete(cidStr) // 一次性消费
            logger.info('text replaced by voice (forced) channel=%s reason=force-voice text=%s', cidStr, text.slice(0, 30))
            queuePending(bot, cidStr, platform, text)
            return []
          }
          if (isTurnReply) {
            const decision = decide(policyCfg, {
              text,
              channelId: cidStr,
              isShared,
              mentioned: false,
              now: Date.now(),
              lastSpeakAt: st.lastSpeakAt.get(cidStr) ?? 0,
            })
            if (decision.speak) {
              logger.info('text replaced by voice channel=%s reason=%s text=%s', cidStr, decision.reason, text.slice(0, 30))
              queuePending(bot, cidStr, platform, text)
              return []
            }
            logger.info('text kept (voice skip) channel=%s reason=%s text=%s', cidStr, decision.reason, text.slice(0, 30))
          }
          // 非 turn 回复（指令等）→ 原样发送
        } else if (text && st.pendingVoice.has(cidStr)) {
          // 同 turn 后续段落：并入语音文本，继续吞
          queuePending(bot, cidStr, platform, text)
          return []
        }
        return origSend(cid, content, ...rest)
      }) as typeof bot.sendMessage
      logger.info('aka-yesimbot-voice: sendMessage patched (replaceText)')
    }

    const plugin: AgentPlugin = {
      name: 'aka-yesimbot-voice',
      // 给 yesimbot LLM 注册正式语音工具：米塔想用语音「喊话/强调/应群友要求」时说出去时调用本工具，
      // 而不是靠 prompt 标记或概率。execute 只给当前频道的 forceVoiceChannels 打强制语音标记，
      // 复用 sendMessage patch 的 force-voice 截流通道（100% 走语音，不做策略判定）。
      // 注：用 AgentPlugin.tools（非 deprecated 的 extendTools）。运行时对 tools 与 extendTools 都是
      // merge 语义（mergeTools([nextTools, declared])），都会与基础工具(sendMessage/read 等)合并、不会覆盖；
      // tools 是官方推荐字段（extendTools 为兼容保留）。
      tools: [
        {
          name: 'use_voice',
          description:
            '把「本条回复」用语音（QQ 语音消息）说出而不是纯文本发送。适用场景：群友明确要求你用语音、或你想用「喊话/强调/有情绪」的方式表达某句话时。调用后本轮你的文本回复会被转成语音发出。平时不要用，仅在用户要求或你想强调语气时调用。',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => {
            voiceState(bot).forceVoiceChannels.set(channelId, Date.now() + FORCE_VOICE_TTL)
            logger.info('use_voice tool invoked channel=%s voice=%s', channelId, resolveCurrentVoice())
            return '已设置：本条回复将用语音发送。'
          },
        },
      ],
      // 记录本 turn 的 <message> 段，供 sendMessage patch 匹配（只吞 yesimbot 回复）
      async onAppend(entries) {
        if (!adv.replaceText) return
        for (const entry of entries) {
          if (entry?.type !== 'message') continue
          const data = entry.data as { role?: string; content?: unknown } | undefined
          if (data?.role !== 'assistant') continue
          const segments = extractTurnSegments(data.content)
          if (segments.length > 0) {
            voiceState(bot).turnSegments.set(channelId, segments)
          }
        }
      },
      // replaceText 模式：turn 结束立即消费；否则在 turn 结束按策略附带语音
      async onTurnFinish(result: TurnResult) {
        const st = voiceState(bot)
        if (adv.replaceText) {
          // 不删 turnSegments：让 sendMessage patch 在消费语音时能读到段去匹配。
          // （旧实现这里 delete 导致 sendMessage 读 isTurnReply 永远 false，语音永不触发）
          const item = st.pendingVoice.get(channelId)
          if (item && !item.consumed) {
            consumePending(channelId, bot, platform)
          }
          return
        }
        const text = extractReplyText(result.messages)
        if (!text) return
        logger.info('voice candidate channel=%s shared=%s text=%s', channelId, isShared, text.slice(0, 40))

        const now = Date.now()
        const decision = decide(policyCfg, {
          text,
          channelId,
          isShared,
          mentioned: false,
          now,
          lastSpeakAt: st.lastSpeakAt.get(channelId) ?? 0,
        })
        if (!decision.speak) {
          logger.info('skip voice channel=%s reason=%s text=%s', channelId, decision.reason, text.slice(0, 30))
          return
        }

        void (async () => {
          try {
            const rendered = await renderVoice(text)
            const voice = currentVoice()
            const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, voice ?? undefined)
            await sendVoice(bot, channelId, out.wavPath, platform, adv.napcatHttpUrl)
            st.lastSpeakAt.set(channelId, Date.now())
            logger.info(
              'voice sent channel=%s voice=%s path=%s len=%d dur=%dms source=%s ratio=%s degraded=%s loudnorm=%s%s wav=%s',
              channelId, voice?.name ?? 'none', voice?.path ?? '', out.pcmBytes, out.durationMs, rendered.source,
              rendered.ratio.toFixed(3), rendered.degraded, String(out.loudnormApplied ?? false),
              rendered.reason ? ` reason=${rendered.reason}` : '', out.wavPath,
            )
          } catch (err) {
            logger.warn('voice failed channel=%s: %s', channelId, err instanceof Error ? err.message : String(err))
          }
        })()
      },
    }
    return plugin
  })

  const voiceName = (() => {
    const v = voices.resolve(resolveCurrentVoice())
    return v ? v.name : '(none)'
  })()
  logger.info(
    'aka-yesimbot-voice registered (voice=%s, llm=%s, replaceText=%s, voiceDir=%s)',
    voiceName, config.llm ? (llmChannel ? 'yesimbot' : 'rules-fallback') : 'off', adv.replaceText, absVoiceDir,
  )
}

/** 把相对 voiceDir 解析为绝对路径（相对 Koishi baseDir） */
function resolveVoiceDir(ctx: Context, voiceDir: string): string {
  if (isAbsolute(voiceDir)) return voiceDir
  const baseDir = (ctx as any).baseDir ?? process.cwd()
  return join(baseDir, voiceDir)
}

/** 输出目录 = voiceDir 的父目录（合成音频与音色分离，便于清理） */
function outputDirOf(voiceDir: string): string {
  return dirname(voiceDir)
}
