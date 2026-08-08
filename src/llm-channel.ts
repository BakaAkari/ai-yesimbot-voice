import type { Context, Logger } from 'koishi'
import type { LanguageModel } from 'ai'

export interface LlmChannel {
  readonly source: 'yesimbot' | 'custom'
  /**
   * 把规则层文本改写成朗读友好文本；失败或超时抛错。
   * timeoutMs 由调用方（preprocess.render）控制上限。
   */
  rewrite(text: string, promptTemplate: string, timeoutMs: number): Promise<string>
}

export interface YesimbotChannelOptions {
  /** yesimbot 模型 fullId（如 deepseek:deepseek-v4-flash）；空 = 用 yesimbot 默认主模型 */
  modelId?: string
  logger?: Logger
}

export interface CustomChannelConfig {
  apiBase: string
  apiKey: string
  model: string
}

function renderPrompt(template: string, text: string): string {
  return template.includes('{text}') ? template.replace('{text}', text) : `${template}\n\n${text}`
}

/**
 * 复用 yesimbot ModelService.resolveChatModel(default) → ai.generateText。
 * ctx.yesimbot 或 ai 包不可用时返回 null（调用方回退到 custom 或规则层）。
 */
export function fromYesimbot(ctx: Context, opts: YesimbotChannelOptions = {}): LlmChannel | null {
  const modelService = (ctx as any)?.yesimbot?.model
  if (!modelService) return null

  return {
    source: 'yesimbot',
    async rewrite(text, promptTemplate, timeoutMs) {
      const wanted: string | undefined = opts.modelId?.trim() || modelService.getDefaultChatModelId?.()
      if (!wanted) throw new Error('yesimbot: no default chat model')
      const ref = modelService.resolveChatModel(wanted)
      if (!ref?.model) throw new Error(`yesimbot: cannot resolve model ${wanted}`)

      const mod = await import('ai').catch(() => null as null)
      if (!mod?.generateText) throw new Error("'ai' package unavailable")

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
      try {
        const result = await mod.generateText({
          model: ref.model as LanguageModel,
          prompt: renderPrompt(promptTemplate, text),
          abortSignal: controller.signal,
        } as Parameters<typeof mod.generateText>[0])
        return String(result?.text ?? '').trim()
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * OpenAI 兼容 /v1/chat/completions 通道（无 yesimbot 时的回退）。
 * 不写日志（key 敏感），异常上抛给 render 降级。
 */
export function fromCustom(
  cfg: CustomChannelConfig,
  fetchLike: typeof fetch = globalThis.fetch.bind(globalThis),
): LlmChannel {
  return {
    source: 'custom',
    async rewrite(text, promptTemplate, timeoutMs) {
      if (!cfg.apiBase) throw new Error('custom: apiBase empty')
      if (!cfg.model) throw new Error('custom: model empty')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
      try {
        const resp = await fetchLike(`${cfg.apiBase.replace(/\/+$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: renderPrompt(promptTemplate, text) }],
            temperature: 0.7,
          }),
          signal: controller.signal,
        })
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '')
          throw new Error(`custom LLM HTTP ${resp.status}: ${detail.slice(0, 120)}`)
        }
        const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
        const raw = data?.choices?.[0]?.message?.content ?? ''
        return String(raw).trim()
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
