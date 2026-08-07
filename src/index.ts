import { Context, Schema, Logger, h, type Bot } from 'koishi'
import type { AgentPlugin, TurnResult, AgentEntry } from '@yesimbot/agent-runtime'
import { TtsClient, type TtsClientConfig } from './tts-client.js'
import { extractReplyText } from './text-extract.js'
import { decide, type TtsPolicyConfig } from './policy.js'
import { sendVoice } from './sender.js'

export const name = 'aka-yesimbot-voice'

/** 依赖 yesimbot service（必选：Koishi 保证在 yesimbot 注册后加载本插件） */
export const inject = ['yesimbot']

export interface Config {
  /** 总开关 */
  ttsEnabled: boolean
  /** 生效平台（onebot / lark） */
  platforms: string[]
  /** TTS 服务地址 */
  ttsApiBase: string
  /** 音色 prompt_wav 本地路径（空 = 服务端默认音色） */
  voicePromptPath: string
  /** instruct_text 朗读指令 */
  instructText: string
  /** 合成超时 ms */
  ttsTimeoutMs: number
  /** 输出目录 */
  outputDir: string
  /** 每条回复配语音概率 */
  probability: number
  /** 最短文本长度 */
  minLength: number
  /** 最长文本长度 */
  maxLength: number
  /** 同渠道冷却秒 */
  cooldownSeconds: number
  /** 仅群聊 */
  groupOnly: boolean
  /** 仅被 @ 时 */
  onMentionOnly: boolean
  /** 发送失败时是否告警日志（不打扰用户） */
  logFailures: boolean
  /** NapCat HTTP API 地址（QQ 语音直发；空 = 回退 Koishi 元素发送） */
  napcatHttpUrl: string
  /** 发语音时吞掉 yesimbot 文本（只发语音，不发文本） */
  replaceText: boolean
}

export const Config: Schema<Config> = Schema.object({
  ttsEnabled: Schema.boolean().default(true).description('总开关：开启后 bot 回复按策略附带语音'),
  platforms: Schema.array(String).default(['onebot']).description('生效平台：onebot（QQ）/ lark（飞书）'),
  ttsApiBase: Schema.string().default('http://127.0.0.1:50000').description('CosyVoice3 服务地址'),
  voicePromptPath: Schema.string().default('').description('音色 prompt_wav 本地路径；留空使用服务端默认音色'),
  instructText: Schema.string().default('请用自然流畅的中英双语朗读，英文单词使用标准英语发音，注意断句和停顿，语速适中。<|endofprompt|>').description('朗读指令'),
  ttsTimeoutMs: Schema.number().min(1000).max(120000).default(30000).description('合成超时 ms'),
  outputDir: Schema.string().default('data/aka-yesimbot-voice').description('合成音频输出目录'),
  probability: Schema.number().min(0).max(1).default(0.2).description('每条回复配语音概率'),
  minLength: Schema.number().min(0).default(8).description('最短文本长度（字符）才配语音'),
  maxLength: Schema.number().min(0).default(120).description('超过此长度不配语音'),
  cooldownSeconds: Schema.number().min(0).default(120).description('同渠道冷却秒数'),
  groupOnly: Schema.boolean().default(true).description('仅群聊配语音'),
  onMentionOnly: Schema.boolean().default(false).description('仅被 @ 时配语音'),
  logFailures: Schema.boolean().default(true).description('合成/发送失败写告警日志（不影响文本回复）'),
  napcatHttpUrl: Schema.string().default('').description('NapCat HTTP API 地址，如 http://mita_napcat:6199；QQ 语音直发走此通道，留空回退 Koishi 元素发送（本地开发）'),
  replaceText: Schema.boolean().default(false).description('命中语音时吞掉 yesimbot 文本回复，只发语音（TTS 失败自动补发文本）'),
})

export function apply(ctx: Context, config: Config) {
  const logger: Logger = ctx.logger('aka-yesimbot-voice')
  const tts = new TtsClient({
    apiBase: config.ttsApiBase,
    timeoutMs: config.ttsTimeoutMs,
    voicePromptPath: config.voicePromptPath,
    instructText: config.instructText,
  } satisfies TtsClientConfig)

  const policyCfg: TtsPolicyConfig = {
    ttsEnabled: config.ttsEnabled,
    probability: config.probability,
    minLength: config.minLength,
    maxLength: config.maxLength,
    cooldownSeconds: config.cooldownSeconds,
    groupOnly: config.groupOnly,
    onMentionOnly: config.onMentionOnly,
  }

  // 每个 channel 独立冷却
  const lastSpeakAt = new Map<string, number>()

  // —— replaceText 模式：吞掉的待发语音（channelId -> 合并后的文本）——
  // 消费用防抖，避免 turn 内多段 <message> 各自触发
  const pendingVoice = new Map<string, { text: string; timer: ReturnType<typeof setTimeout>; consumed: boolean }>()

  function consumePending(channelId: string, bot: Bot, platform: string): void {
    const item = pendingVoice.get(channelId)
    if (!item || item.consumed) return
    item.consumed = true
    if (item.timer) clearTimeout(item.timer)
    pendingVoice.delete(channelId)
    const text = item.text
    void (async () => {
      try {
        const out = await tts.synthesize(text, config.outputDir, `voice-${Date.now()}.wav`)
        await sendVoice(bot, channelId, out.wavPath, platform, config.napcatHttpUrl)
        lastSpeakAt.set(channelId, Date.now())
        logger.info('voice sent (text replaced) channel=%s len=%d dur=%dms text=%s', channelId, out.pcmBytes, out.durationMs, text.slice(0, 30))
      } catch (err) {
        // TTS/发送失败：补发文本，保证回复不丢
        logger.warn('voice failed, fallback text channel=%s: %s', channelId, err instanceof Error ? err.message : String(err))
        try {
          await bot.sendMessage(channelId, text)
          logger.info('fallback text sent channel=%s', channelId)
        } catch (fallbackErr) {
          if (config.logFailures) {
            logger.warn('fallback text also failed channel=%s: %s', channelId, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
          }
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

  type ChannelRef = { bot: Parameters<typeof sendVoice>[0]; channelId: string; platform: string; isShared: boolean }
  let currentChannelCtx: ChannelRef | null = null

  const voicePlugin: AgentPlugin = {
    name: 'aka-yesimbot-voice',
    // replaceText 模式下：turn 结束时立即消费（不等防抖）
    async onTurnFinish(result) {
      const ctxRef = currentChannelCtx
      if (!ctxRef) return
      const { bot, channelId, platform } = ctxRef
      if (config.replaceText) {
        const item = pendingVoice.get(channelId)
        if (item && !item.consumed) {
          consumePending(channelId, bot, platform)
        }
        return
      }
      // —— 旧模式：文本照发，语音附带 ——
      if (!config.platforms.includes(platform)) return
      const text = extractReplyText(result.messages)
      if (!text) return
      logger.info('voice candidate channel=%s shared=%s text=%s', channelId, ctxRef.isShared, text.slice(0, 40))

      const now = Date.now()
      const decision = decide(policyCfg, {
        text,
        channelId,
        isShared: ctxRef.isShared,
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
          const out = await tts.synthesize(text, config.outputDir, `voice-${Date.now()}.wav`)
          await sendVoice(bot, channelId, out.wavPath, platform, config.napcatHttpUrl)
          lastSpeakAt.set(channelId, Date.now())
          logger.info('voice sent channel=%s len=%d dur=%dms wav=%s', channelId, out.pcmBytes, out.durationMs, out.wavPath)
        } catch (err) {
          if (config.logFailures) {
            logger.warn('voice failed channel=%s: %s', channelId, err instanceof Error ? err.message : String(err))
          }
        }
      })()
    },
  }

  // inject 声明保证 yesimbot service 已注册（若存在）；apply 时直接注册 channel plugin
  const yesimbot = (ctx as any).yesimbot
  if (!yesimbot?.registerChannelPlugin) {
    logger.warn('yesimbot service unavailable — plugin inactive')
    return
  }
  yesimbot.registerChannelPlugin(({ bot, scope }: any) => {
    currentChannelCtx = {
      bot,
      channelId: scope.channelId,
      platform: scope.platform,
      isShared: scope.type === 'shared',
    }

    // replaceText 模式：patch 发送出口，命中语音策略时吞掉文本
    if (config.replaceText && config.platforms.includes(scope.platform)) {
      const origSend = bot.sendMessage.bind(bot)
      bot.sendMessage = (async (channelId: string, content: unknown, ...rest: unknown[]) => {
        const text = extractSendText(content)
        const channelIdStr = String(channelId)
        const now = Date.now()
        const isShared = scope.type === 'shared'
        // 仅群聊 + 策略命中 → 吞文本排队语音；否则原样发送
        // 注意：冷却判定交给 decide()（now - lastSpeakAt < cooldownSeconds），
        // 不能用 lastSpeakAt.has() 存在性判断（历史语音记录会永久跳过判定）
        if (text && isShared && !pendingVoice.has(channelIdStr)) {
          const decision = decide(policyCfg, {
            text,
            channelId: channelIdStr,
            isShared,
            mentioned: false,
            now,
            lastSpeakAt: lastSpeakAt.get(channelIdStr) ?? 0,
          })
          if (decision.speak) {
            logger.info('text replaced by voice channel=%s reason=%s text=%s', channelIdStr, decision.reason, text.slice(0, 30))
            queuePending(bot, channelIdStr, scope.platform, text)
            return []
          }
          logger.info('text kept (voice skip) channel=%s reason=%s text=%s', channelIdStr, decision.reason, text.slice(0, 30))
        } else if (text && pendingVoice.has(channelIdStr)) {
          // 同 turn 后续段落：并入语音文本，继续吞
          queuePending(bot, channelIdStr, scope.platform, text)
          return []
        }
        return origSend(channelId, content, ...rest)
      }) as typeof bot.sendMessage
      logger.info('aka-yesimbot-voice: sendMessage patched for channel %s (replaceText)', scope.channelId)
    }
    return voicePlugin
  })
  logger.info('aka-yesimbot-voice registered (platforms=%s, replaceText=%s)', config.platforms.join(','), config.replaceText)
}
