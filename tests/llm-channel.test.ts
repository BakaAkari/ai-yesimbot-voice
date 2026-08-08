import { describe, test, expect, vi } from 'vitest'
import { fromYesimbot, fromCustom } from '../src/llm-channel.js'

describe('fromYesimbot', () => {
  test('returns null when ctx.yesimbot missing', () => {
    const ch = fromYesimbot({} as any)
    expect(ch).toBeNull()
  })

  test('null when yesimbot has no model service', () => {
    const ch = fromYesimbot({ yesimbot: {} } as any)
    expect(ch).toBeNull()
  })

  test('throws when no default model and no override', async () => {
    const ctx: any = {
      yesimbot: {
        model: {
          getDefaultChatModelId: () => undefined,
          resolveChatModel: () => {
            throw new Error('should not be called')
          },
        },
      },
    }
    const ch = fromYesimbot(ctx)!
    await expect(ch.rewrite('你好', '{text}', 100)).rejects.toThrow(/no default chat model/)
  })
})

describe('fromCustom', () => {
  test('posts OpenAI-compatible request and returns content', async () => {
    const fetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ choices: [{ message: { content: '改写后的文本' } }] }),
    }) as unknown as Response)
    const ch = fromCustom({ apiBase: 'http://llm.test', apiKey: 'sk-xxx', model: 'gpt-mini' }, fetchLike as never)
    const out = await ch.rewrite('原文', '改写{text}', 5000)
    expect(out).toBe('改写后的文本')
    expect(fetchLike).toHaveBeenCalledTimes(1)
    const [url, init] = fetchLike.mock.calls[0] as [string, any]
    expect(url).toBe('http://llm.test/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-xxx')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-mini')
    expect(body.messages[0].content).toBe('改写原文')
  })

  test('throws on http error', async () => {
    const fetchLike = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'server error',
      json: async () => ({}),
    }) as unknown as Response)
    const ch = fromCustom({ apiBase: 'http://llm.test', apiKey: '', model: 'x' }, fetchLike as never)
    await expect(ch.rewrite('t', '{text}', 5000)).rejects.toThrow(/500/)
  })

  test('aborts on timeout', async () => {
    const fetchLike = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    )
    const ch = fromCustom({ apiBase: 'http://llm.test', apiKey: '', model: 'x' }, fetchLike as never)
    await expect(ch.rewrite('t', '{text}', 20)).rejects.toThrow()
  })

  test('missing apiBase throws before fetch', async () => {
    const fetchLike = vi.fn()
    const ch = fromCustom({ apiBase: '', apiKey: '', model: 'x' }, fetchLike as never)
    await expect(ch.rewrite('t', '{text}', 5000)).rejects.toThrow(/apiBase empty/)
    expect(fetchLike).not.toHaveBeenCalled()
  })

  test('missing model throws before fetch', async () => {
    const fetchLike = vi.fn()
    const ch = fromCustom({ apiBase: 'http://llm.test', apiKey: '', model: '' }, fetchLike as never)
    await expect(ch.rewrite('t', '{text}', 5000)).rejects.toThrow(/model empty/)
  })
})
