import type { AgentMessage } from '@yesimbot/agent-runtime'

/**
 * 从 TurnResult.messages 中提取 assistant（bot 回复）纯文本。
 * AgentAssistantMessage.content 是 AI SDK 的 AssistantContent：
 *   - string：直接文本
 *   - Array<{ type: 'text', text } | { type: 'image', image } | ...>：取 text parts
 * 只提取 role === 'assistant' 的消息；跳过 tool/custom 消息。
 */
export function extractReplyText(messages: readonly AgentMessage[] | undefined | null): string {
  if (!Array.isArray(messages)) return ''
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const content = (message as { content?: unknown }).content
    const text = contentToText(content)
    if (text) return text
  }
  return ''
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return stripMessageTags(content.trim())
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) parts.push(stripMessageTags(text.trim()))
    }
  }
  return parts.join('\n').trim()
}

/**
 * 剥离 yesimbot/AI 回复中的 XML 包裹标签（<message>...</message> 等），
 * 避免 TTS 把标签当正文念出来。
 */
function stripMessageTags(text: string): string {
  return text
    .replace(/<\/?message>/g, '')
    .replace(/<[^>]+>/g, (tag) => (tag.startsWith('</') || tag.startsWith('<message') ? '' : tag))
    .trim()
}
