import { Context, Schema, Logger, type Bot } from 'koishi'
import { join, dirname, isAbsolute } from 'node:path'
import type { AgentPlugin, TurnResult } from '@yesimbot/agent-runtime'
import { TtsClient, type TtsClientConfig } from './tts-client.js'
import { extractReplyText } from './text-extract.js'
import { decide, type TtsPolicyConfig } from './policy.js'
import { sendVoice } from './sender.js'
import { render, type RenderOptions } from './preprocess.js'
import { fromYesimbot, type LlmChannel } from './llm-channel.js'
import { VoiceLibrary } from './voices.js'

const DEFAULT_LLM_PROMPT = `你是专业的声音导演。把下面的对话回复改写成\"朗读友好文本\"，交给 CosyVoice 合成语音。
要求：
1. 保留原意与信息，不得增删事实、不得改人称/数字/专有名词
2. 加入自然的口语节奏：适当断句、停顿提示、语气词（嗯、啊、哈），增强情绪表达
3. 文本中可用以下标记控制韵律：[breath] 换气 [laughter] 笑声 [sigh] 叹气（适量使用，每句最多 1 个）
4. 标点规范化：句末必须有句号/问号/感叹号；逗号表示短停顿，句号表示长停顿
5. 英文单词保持原样，前后加空格；数字按自然读法改写（如 3.5 → 三点五）
6. 只输出改写后的文本本身，不要解释、不要引号、不要 markdown
7. 输出长度与原文本相当（±30%），不得扩写

原文：
{text}`

export const name = 'aka-yesimbot-voice'

/** 依赖 yesimbot service（必选：Koishi 保证在 yesimbot 注册后加载本插件） */
export const inject = ['yesimbot']

/**
 * 极简配置模型（v0.3.0 重构，无旧字段兼容负担）。
 * - 基础：音色、触发概率、LLM 渲染开关、音色源目录
 * - advanced：不常改的默认值折叠隐藏
 */
export interface Config {
  /** 音色名；'auto' = 音色目录按字母序第一个 */
  voice: string
  /** 每条回复配语音概率 0-1 */
  probability: number
  /** LLM 语音效果渲染（走 yesimbot 主模型通道；失败自动降级规则层） */
  llm: boolean
  /** 音色源目录：管理员放/删 *.wav 即增删音色（重启生效） */
  voiceDir: string

  advanced: {
    /** CosyVoice3 服务地址 */
    ttsApiBase: string
    /** 朗读指令（中英混排） */
    instructText: string
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
  }
}

export const Config: Schema<Config> = Schema.object({
  voice: Schema.string()
    .default('auto')
    .description('当前音色：auto=音色目录第一个，或直接填音色名（如 leijun / gs_Collei）'),
  probability: Schema.number().min(0).max(1).default(0.85).description('每条回复配语音概率'),
  llm: Schema.boolean().default(true).description('LLM 语音效果渲染（走 yesimbot 主模型；失败自动降级规则层）'),
  voiceDir: Schema.string().default('data/aka-yesimbot-voice/voices').description('音色源目录：往里放/删 *.wav 即增删音色（重启生效）'),

  advanced: Schema.object({
    ttsApiBase: Schema.string().default('http://100.121.167.1:50000').description('CosyVoice3 服务地址'),
    instructText: Schema.string().default('请用自然流畅的中英双语朗读，英文单词使用标准英语发音，注意断句和停顿，语速适中。<|endofprompt|>').description('朗读指令'),
    ttsTimeoutMs: Schema.number().min(1000).max(120000).default(30000).description('合成超时 ms'),
    minLength: Schema.number().min(0).default(4).description('最短触发文本长度（字符）'),
    maxLength: Schema.number().min(0).default(120).description('最长触发文本长度（字符）'),
    cooldownSeconds: Schema.number().min(0).default(60).description('同渠道冷却秒'),
    groupOnly: Schema.boolean().default(true).description('仅群聊配语音'),
    onMentionOnly: Schema.boolean().default(false).description('仅被 @ 时配语音'),
    replaceText: Schema.boolean().default(true).description('命中时吞掉 yesimbot 文本只发语音（TTS 失败自动补发文本）'),
    napcatHttpUrl: Schema.string().default('http://mita_napcat:6199').description('NapCat HTTP API（QQ 语音直发）'),
  }).description('高级设置（一般不用动）'),
})

export function apply(ctx: Context, config: Config) {
  const logger: Logger = ctx.logger('aka-yesimbot-voice')
  const adv = config.advanced
  const tts = new TtsClient({
    apiBase: adv.ttsApiBase,
    timeoutMs: adv.ttsTimeoutMs,
    instructText: adv.instructText,
  } satisfies TtsClientConfig)

  // 音色库：volatile 生命周期内每次解析都重新扫描目录（放/删音色重启生效）
  const absVoiceDir = resolveVoiceDir(ctx, config.voiceDir)
  const outputDir = outputDirOf(absVoiceDir)
  const voices = new VoiceLibrary(absVoiceDir)

  // 当前音色持久化（settings.json，重启不丢）。优先级：settings 覆盖 config.voice。
  const settingsPath = join(dirname(absVoiceDir), 'settings.json')
  function loadSavedVoice(): string {
    try {
      const { readFileSync } = require('node:fs') as typeof import('node:fs')
      const data = JSON.parse(readFileSync(settingsPath, 'utf8')) as { voice?: string }
      if (typeof data.voice === 'string' && data.voice) return data.voice
    } catch { /* 无或损坏 */ }
    return config.voice
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
  let currentVoice = loadSavedVoice()

  // 语音效果渲染通道（llm=false → 只跑规则层；yesimbot 通道构建失败自动降级规则层）
  let llmChannel: LlmChannel | null = null
  if (config.llm) {
    llmChannel = fromYesimbot(ctx, { logger })
    if (!llmChannel) logger.warn('llm channel yesimbot unavailable — falling back to rules')
  }
  const renderOpts: RenderOptions = {
    llm: llmChannel,
    fidelityRatio: 0.95,
    injectBreath: true,
    timeoutMs: 60000,
    prompt: DEFAULT_LLM_PROMPT,
    logPrompts: false,
    logger,
  }
  async function renderVoice(text: string) {
    return render(text, renderOpts)
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

  // 每个 channel 独立冷却
  const lastSpeakAt = new Map<string, number>()

  // —— replaceText 模式 ——
  // 待发语音队列（channelId -> 文本），消费防抖 600ms，turn 结束时立即消费
  const pendingVoice = new Map<string, { text: string; timer: ReturnType<typeof setTimeout>; consumed: boolean }>()
  // 每个 channel 最近 turn 的 <message> 段（onAppend 记录，patch 匹配用）
  // 只吞"发送文本 == 某 turn 回复段"的调用 → 指令返回/其他插件发送永不吞
  const turnSegments = new Map<string, string[]>()

  /** 解析当前音色 wav 路径（auto/具名）；目录无音色返回 null（回退服务端默认音色） */
  function currentVoicePath(): string | undefined {
    return voices.resolve(currentVoice)?.path
  }

  function consumePending(channelId: string, bot: Bot, platform: string): void {
    const item = pendingVoice.get(channelId)
    if (!item || item.consumed) return
    item.consumed = true
    if (item.timer) clearTimeout(item.timer)
    pendingVoice.delete(channelId)
    const text = item.text
    void (async () => {
      try {
        const rendered = await renderVoice(text)
        const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, currentVoicePath())
        await sendVoice(bot, channelId, out.wavPath, platform, adv.napcatHttpUrl)
        lastSpeakAt.set(channelId, Date.now())
        logger.info(
          'voice sent (text replaced) channel=%s len=%d dur=%dms source=%s ratio=%s degraded=%s%s rendered=%s',
          channelId, out.pcmBytes, out.durationMs, rendered.source, rendered.ratio.toFixed(3), rendered.degraded,
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
    const existing = pendingVoice.get(channelId)
    if (existing && !existing.consumed) {
      // 同 turn 多段：合并文本，重置防抖
      existing.text = existing.text.length > text.length ? existing.text : text
      if (existing.timer) clearTimeout(existing.timer)
      existing.timer = setTimeout(() => consumePending(channelId, bot, platform), 600)
      return
    }
    const timer = setTimeout(() => consumePending(channelId, bot, platform), 600)
    pendingVoice.set(channelId, { text, timer, consumed: false })
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

  // —— .voice 指令：管理员列/切换音色 ——
  ctx.command('voice', '语音设置：查看 / 切换当前音色')
    .action(async ({ session }) => {
      if (!session) return '需要会话上下文。'
      const list = voices.scan()
      const current = voices.resolve(currentVoice)
      if (!list.length) return '音色目录为空：往 voiceDir 放入 *.wav（重启生效）。'
      const lines = list.map((v) => `${v.name === current?.name ? '● ' : '○ '}${v.name}`).join('\n')
      return `当前音色：${current?.name ?? '（无）'}\n可用音色：\n${lines}\n\n用 .voice <音色名> 切换`
    })

  ctx.command('voice <name>', '切换到指定音色')
    .action(async ({ session }, name) => {
      if (!session) return '需要会话上下文。'
      if (!name) return '用法：.voice <音色名>（先 .voice 查看可用列表）'
      const list = voices.scan()
      const found = list.find((v) => v.name === name)
      if (!found) return `没有音色「${name}」。用 .voice 查看可用列表。`
      currentVoice = name
      saveVoice(name)
      logger.info('voice switched to %s by user', name)
      return `✅ 已切换到音色「${name}」（已保存，重启不丢）。`
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
        if (text && isShared && !pendingVoice.has(cidStr)) {
          const segments = turnSegments.get(cidStr) ?? []
          const isTurnReply = segments.includes(text)
          if (isTurnReply) {
            const decision = decide(policyCfg, {
              text,
              channelId: cidStr,
              isShared,
              mentioned: false,
              now: Date.now(),
              lastSpeakAt: lastSpeakAt.get(cidStr) ?? 0,
            })
            if (decision.speak) {
              logger.info('text replaced by voice channel=%s text=%s', cidStr, text.slice(0, 30))
              queuePending(bot, cidStr, platform, text)
              return []
            }
            logger.info('text kept (voice skip) channel=%s reason=%s text=%s', cidStr, decision.reason, text.slice(0, 30))
          }
          // 非 turn 回复（指令等）→ 原样发送
        } else if (text && pendingVoice.has(cidStr)) {
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
      // 记录本 turn 的 <message> 段，供 sendMessage patch 匹配（只吞 yesimbot 回复）
      async onAppend(entries) {
        if (!adv.replaceText) return
        for (const entry of entries) {
          if (entry?.type !== 'message') continue
          const data = entry.data as { role?: string; content?: unknown } | undefined
          if (data?.role !== 'assistant') continue
          const segments = extractTurnSegments(data.content)
          if (segments.length > 0) {
            turnSegments.set(channelId, segments)
          }
        }
      },
      // replaceText 模式：turn 结束立即消费；否则在 turn 结束按策略附带语音
      async onTurnFinish(result: TurnResult) {
        if (adv.replaceText) {
          turnSegments.delete(channelId)
          const item = pendingVoice.get(channelId)
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
          lastSpeakAt: lastSpeakAt.get(channelId) ?? 0,
        })
        if (!decision.speak) {
          logger.info('skip voice channel=%s reason=%s text=%s', channelId, decision.reason, text.slice(0, 30))
          return
        }

        void (async () => {
          try {
            const rendered = await renderVoice(text)
            const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, currentVoicePath())
            await sendVoice(bot, channelId, out.wavPath, platform, adv.napcatHttpUrl)
            lastSpeakAt.set(channelId, Date.now())
            logger.info(
              'voice sent channel=%s len=%d dur=%dms source=%s ratio=%s degraded=%s%s wav=%s',
              channelId, out.pcmBytes, out.durationMs, rendered.source, rendered.ratio.toFixed(3), rendered.degraded,
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
    const v = voices.resolve(currentVoice)
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
