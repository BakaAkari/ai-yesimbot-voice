import { describe, test, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { TtsClient } from '../src/tts-client.js'
import { wrapWav } from '../src/tts-client.js'

const TMP = '/tmp/aka-yesimbot-voice-test'
const cfg = {
  apiBase: 'http://tts.test:50000',
  timeoutMs: 5000,
  instructText: '请自然朗读。<|endofprompt|>',
}

function mockFetch(response: { ok?: boolean; status?: number; body?: Buffer; text?: string }) {
  return vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    arrayBuffer: async () => (response.body ?? Buffer.alloc(0)).buffer,
    text: async () => response.text ?? '',
  }) as unknown as Response)
}

describe('wrapWav', () => {
  test('44-byte header + PCM payload, 24kHz mono 16bit', () => {
    const pcm = Buffer.alloc(100, 0x7f)
    const wav = wrapWav(pcm)
    expect(wav.length).toBe(144)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(100)
  })
})

describe('TtsClient.synthesize', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  test('posts multipart and writes wav file', async () => {
    const pcm = Buffer.alloc(4800, 0x00)
    const fetchLike = mockFetch({ body: pcm })
    const client = new TtsClient(cfg, fetchLike as never)

    const result = await client.synthesize('你好', TMP, 'out.wav')

    expect(fetchLike).toHaveBeenCalledTimes(1)
    const [url, init] = fetchLike.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe('http://tts.test:50000/inference_instruct2')
    expect(init.headers['Content-Type']).toContain('multipart/form-data')
    expect(result.pcmBytes).toBe(4800)
    expect(existsSync(result.wavPath)).toBe(true)
    const wav = readFileSync(result.wavPath)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.length).toBe(4800 + 44)
  })

  test('includes prompt_wav when voicePromptPath passed to synthesize', async () => {
    const fs = await import('node:fs')
    fs.mkdirSync(TMP, { recursive: true })
    const promptPath = `${TMP}/prompt.wav`
    fs.writeFileSync(promptPath, Buffer.alloc(100, 0x11))
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient(cfg, fetchLike as never)

    await client.synthesize('测试', TMP, 'p.wav', promptPath)

    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const body = Buffer.from(init.body)
    const bodyText = body.toString('latin1')
    expect(bodyText).toContain('prompt.wav')
    expect(bodyText).toContain('audio/wav')
  })

  test('omits prompt_wav when no voicePromptPath', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient(cfg, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav')
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText).not.toContain('prompt.wav')
  })

  test('auto-appends <|endofprompt|> when instruct lacks it', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient({ ...cfg, instructText: '自然朗读' }, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav')
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText).toContain('<|endofprompt|>')
  })

  test('keeps existing <|endofprompt|> in instruct', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient({ ...cfg, instructText: '自然朗读。<|endofprompt|>' }, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav')
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText.match(/<\|endofprompt\|>/g)).toHaveLength(1)
  })

  test('throws on http error', async () => {
    const fetchLike = mockFetch({ ok: false, status: 502, text: 'bad gateway' })
    const client = new TtsClient(cfg, fetchLike as never)
    await expect(client.synthesize('hi', TMP, 'x.wav')).rejects.toThrow(/502/)
  })

  test('throws on empty audio', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(0) })
    const client = new TtsClient(cfg, fetchLike as never)
    await expect(client.synthesize('hi', TMP, 'x.wav')).rejects.toThrow(/empty audio/)
  })
})
