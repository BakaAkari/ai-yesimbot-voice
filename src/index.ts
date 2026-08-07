import { Context, Schema, Logger } from 'koishi'
import type { AgentPlugin, TurnResult } from '@yesimbot/agent-runtime'
import { TtsClient, type TtsClientConfig } from './tts-client.js'
import { extractReplyText } from './text-extract.js'
import { decide, type TtsPolicyConfig } from './policy.js'
import { sendVoice } from './sender.js'

export const name = 'aka-yesimbot-voice'

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

  type ChannelRef = { bot: Parameters<typeof sendVoice>[0]; channelId: string; platform: string }
  let currentChannelCtx: ChannelRef | null = null

  const voicePlugin: AgentPlugin = {
    name: 'aka-yesimbot-voice',
    async onTurnFinish(result) {
      const ctxRef = currentChannelCtx
      if (!ctxRef) return
      const { bot, channelId, platform } = ctxRef
      if (!config.platforms.includes(platform)) return

      const text = extractReplyText(result.messages)
      if (!text) return

      const now = Date.now()
      const decision = decide(policyCfg, {
        text,
        channelId,
        mentioned: false, // onTurnFinish 无 mention 信息；如需 @ 判定改由输入事件侧记录
        now,
        lastSpeakAt: lastSpeakAt.get(channelId) ?? 0,
      })
      if (!decision.speak) {
        logger.debug('skip voice channel=%s reason=%s text=%s', channelId, decision.reason, text.slice(0, 30))
        return
      }

      // 异步合成 + 发送，失败静默（不阻塞 turn 完成、不影响文本回复）
      void (async () => {
        try {
          const out = await tts.synthesize(text, config.outputDir, `voice-${Date.now()}.wav`)
          await sendVoice(bot, channelId, out.wavPath, platform)
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

  ctx.on('ready', async () => {
    const yesimbot = (ctx as any).yesimbot
    if (!yesimbot?.registerChannelPlugin) {
      logger.warn('yesimbot service unavailable — plugin inactive')
      return
    }
    yesimbot.registerChannelPlugin(({ bot, scope }: any) => {
      currentChannelCtx = { bot, channelId: scope.channelId, platform: scope.platform }
      return voicePlugin
    })
    logger.info('aka-yesimbot-voice registered (platforms=%s)', config.platforms.join(','))
  })
}
