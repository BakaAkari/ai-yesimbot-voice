import { describe, test, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { TtsClient } from '../src/tts-client.js'
import { wrapWav } from '../src/tts-client.js'

const TMP = '/tmp/aka-yesimbot-voice-test'
const cfg = {
  apiBase: 'http://tts.test:50000',
  timeoutMs: 5000,
  tailPadMs: 0,
  speed: 1.2,
  loudnorm: false,
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

  test('appends trailing silence when tailPadMs > 0', () => {
    const pcm = Buffer.alloc(100, 0x7f)
    const tailMs = 400 // 400ms @ 24kHz = 9600 samples = 19200 bytes
    const wav = wrapWav(pcm, tailMs)
    expect(wav.length).toBe(44 + 100 + 19200)
    // data size = pcm + tail
    expect(wav.readUInt32LE(40)).toBe(100 + 19200)
    // tail region is silence (zeros)
    for (let i = 44 + 100; i < wav.length; i++) {
      expect(wav[i]).toBe(0)
    }
    // pcm region preserved
    expect(wav[44]).toBe(0x7f)
  })

  test('tailPadMs 0 does not add padding', () => {
    const wav = wrapWav(Buffer.alloc(10, 0x00), 0)
    expect(wav.length).toBe(54)
    expect(wav.readUInt32LE(40)).toBe(10)
  })
})

describe('TtsClient.synthesize', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  test('posts multipart to /inference_zero_shot and writes wav file', async () => {
    const pcm = Buffer.alloc(4800, 0x00)
    const fetchLike = mockFetch({ body: pcm })
    const client = new TtsClient(cfg, fetchLike as never)

    const result = await client.synthesize('你好', TMP, 'out.wav')

    expect(fetchLike).toHaveBeenCalledTimes(1)
    const [url, init] = fetchLike.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe('http://tts.test:50000/inference_zero_shot')
    expect(init.headers['Content-Type']).toContain('multipart/form-data')
    expect(result.pcmBytes).toBe(4800)
    expect(existsSync(result.wavPath)).toBe(true)
    const wav = readFileSync(result.wavPath)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.length).toBe(4800 + 44)
  })

  test('includes prompt_wav when voice.path passed to synthesize', async () => {
    const fs = await import('node:fs')
    fs.mkdirSync(TMP, { recursive: true })
    const promptPath = `${TMP}/prompt.wav`
    fs.writeFileSync(promptPath, Buffer.alloc(100, 0x11))
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient(cfg, fetchLike as never)

    await client.synthesize('测试', TMP, 'p.wav', { path: promptPath })

    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText).toContain('prompt.wav')
    expect(bodyText).toContain('audio/wav')
  })

  test('omits prompt_wav when no voice.path', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient(cfg, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav', { transcript: '参考转写' })
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText).not.toContain('prompt.wav')
  })

  test('sends voice.transcript as prompt_text', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient(cfg, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav', { transcript: '大家好，很高兴见到你' })
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('utf8')
    expect(bodyText).toContain('name="prompt_text"')
    expect(bodyText).toContain('大家好，很高兴见到你')
  })

  test('sends empty prompt_text when no transcript', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient(cfg, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav')
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText).toContain('name="prompt_text"')
    expect(bodyText).not.toContain('请用自然流畅的中英双语朗读')
  })

  test('sends speed field with configured value', async () => {
    const fetchLike = mockFetch({ body: Buffer.alloc(44) })
    const client = new TtsClient({ ...cfg, speed: 1.2 }, fetchLike as never)
    await client.synthesize('测试', TMP, 'p.wav')
    const [, init] = fetchLike.mock.calls[0] as [string, { body: Uint8Array }]
    const bodyText = Buffer.from(init.body).toString('latin1')
    expect(bodyText).toContain('name="speed"')
    expect(bodyText).toContain('1.2')
  })

  test('applies loudnorm when enabled (second call to /loudnorm)', async () => {
    const lnBody = Buffer.alloc(4800, 0x33)
    const fetchLike = vi.fn(async (url: string) => {
      if (String(url).endsWith('/loudnorm')) {
        return { ok: true, status: 200, arrayBuffer: async () => lnBody.buffer } as unknown as Response
      }
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(4800, 0x00).buffer } as unknown as Response
    })
    const client = new TtsClient({ ...cfg, loudnorm: true }, fetchLike as never)
    const result = await client.synthesize('你好', TMP, 'out.wav')
    expect(fetchLike).toHaveBeenCalledTimes(2)
    expect(String(fetchLike.mock.calls[1][0])).toBe('http://tts.test:50000/loudnorm')
    expect(result.loudnormApplied).toBe(true)
    expect(result.pcmBytes).toBe(4800)
  })

  test('degrades to raw pcm when loudnorm endpoint fails', async () => {
    const fetchLike = vi.fn(async (url: string) => {
      if (String(url).endsWith('/loudnorm')) {
        return { ok: false, status: 404, text: async () => '' } as unknown as Response
      }
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(4800, 0x00).buffer } as unknown as Response
    })
    const client = new TtsClient({ ...cfg, loudnorm: true }, fetchLike as never)
    const result = await client.synthesize('你好', TMP, 'out.wav')
    expect(result.loudnormApplied).toBe(false)
    expect(result.pcmBytes).toBe(4800)
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
