import type { Context } from 'koishi'

/** 语音配发策略：决定本次回复是否配语音（"适当"的工程化）。 */
export interface TtsPolicyConfig {
  /** 每条回复配语音概率 0-1 */
  probability: number
  /** 文本最短长度（字符）才配语音 */
  minLength: number
  /** 文本最长长度（字符），超过则不配（避免长文朗读） */
  maxLength: number
  /** 同渠道冷却秒数 */
  cooldownSeconds: number
  /** 仅群聊配语音 */
  groupOnly: boolean
  /** 仅被 @ 时配语音 */
  onMentionOnly: boolean
  /** 总开关 */
  ttsEnabled: boolean
}

export interface TtsDecision {
  speak: boolean
  reason: string
}

/** 群聊判定：优先用 scope.type（shared/direct），channelId 前缀兜底 */
export function isGroupChannel(channelId: string, isShared?: boolean): boolean {
  if (isShared !== undefined) return isShared
  return channelId.startsWith('group:')
}

/**
 * 策略判定（纯函数，便于单测）：
 * - 总开关关闭 → 不配
 * - 平台不在生效列表 → 不配
 * - 群聊限定 & 非群 → 不配
 * - @ 限定 & 非 @ → 不配
 * - 长度 < minLength 或 > maxLength → 不配
 * - 冷却期内 → 不配（由调用方传入 lastSpeakAt）
 * - 概率命中 → 配
 */
export function decide(
  cfg: TtsPolicyConfig,
  opts: {
    text: string
    channelId: string
    isShared?: boolean
    mentioned: boolean
    now: number
    lastSpeakAt: number
  },
): TtsDecision {
  if (!cfg.ttsEnabled) return { speak: false, reason: 'tts-disabled' }
  const textLen = Array.from(opts.text).length
  if (cfg.groupOnly && !isGroupChannel(opts.channelId, opts.isShared)) return { speak: false, reason: 'not-group' }
  if (cfg.onMentionOnly && !opts.mentioned) return { speak: false, reason: 'not-mentioned' }
  if (textLen < cfg.minLength) return { speak: false, reason: 'too-short' }
  if (textLen > cfg.maxLength) return { speak: false, reason: 'too-long' }
  if (opts.now - opts.lastSpeakAt < cfg.cooldownSeconds * 1000) return { speak: false, reason: 'cooldown' }
  const roll = Math.random()
  if (roll >= cfg.probability) return { speak: false, reason: 'probability-miss' }
  return { speak: true, reason: 'hit' }
}

/** 冷却检查（供调用方维护 lastSpeakAt 前使用） */
export function inCooldown(lastSpeakAt: number, now: number, cooldownSeconds: number): boolean {
  return now - lastSpeakAt < cooldownSeconds * 1000
}

/** 从 Koishi session 判断是否被 @（mention 元素包含 bot selfId） */
export function isMentioned(ctx: Context, elements: readonly unknown[], selfId: string): boolean {
  for (const el of elements) {
    if (el && typeof el === 'object') {
      const e = el as { type?: string; attrs?: Record<string, unknown> }
      if (e.type === 'at' && (e.attrs?.id === selfId || e.attrs?.name === 'self')) return true
    }
  }
  return false
}
