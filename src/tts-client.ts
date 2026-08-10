import type { Logger } from 'koishi'

export interface TtsClientConfig {
  apiBase: string
  /** 请求超时 ms */
  timeoutMs: number
}

/** 合成所需的音色：参考音频路径 + 可选参考转写（zero_shot 的 prompt_text） */
export interface TtsVoiceSource {
  /** 音色参考音频 wav 路径 */
  path?: string
  /** 该音色参考音频的真实转写；缺失时以空字符串发送（弱化条件对齐） */
  transcript?: string
}

export interface TtsSynthesisResult {
  /** 24kHz 16bit mono WAV 文件路径 */
  wavPath: string
  /** 合成耗时 ms */
  durationMs: number
  /** 原始 PCM 字节数 */
  pcmBytes: number
}

const WAV_HEADER_SIZE = 44

/**
 * CosyVoice3 /inference_zero_shot 客户端。
 * 请求：multipart（tts_text / prompt_text / prompt_wav）
 *   - tts_text：要朗读的正文
 *   - prompt_text：参考音频(prompt_wav)的真实转写，zero_shot 语音条件对齐，不是指令
 *   - prompt_wav：音色参考音频
 * 响应：raw 24kHz 16bit mono PCM → 本地封装 WAV 头。
 * 失败抛错（由调用方静默降级）。
 */
export class TtsClient {
  constructor(
    private readonly config: TtsClientConfig,
    private readonly fetchLike: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async synthesize(text: string, outDir: string, outName = 'voice.wav', voice?: TtsVoiceSource): Promise<TtsSynthesisResult> {
    const startedAt = Date.now()
    const { apiBase, timeoutMs } = this.config
    const boundary = `----akaTts${Date.now()}${Math.random().toString(16).slice(2)}`
    const chunks: Buffer[] = []

    // zero_shot：prompt_text = 参考音频转写；服务端自动补 <|endofprompt|>，这里原样发送。
    const promptText = (voice?.transcript ?? '').trim()
    const pushField = (name: string, value: string) => {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
    pushField('tts_text', text)
    pushField('prompt_text', promptText)
    if (voice?.path) {
      const fs = await import('node:fs')
      const audio = await fs.promises.readFile(voice.path)
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt_wav"; filename="prompt.wav"\r\nContent-Type: audio/wav\r\n\r\n`))
      chunks.push(audio)
      chunks.push(Buffer.from('\r\n'))
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await this.fetchLike(`${apiBase}/inference_zero_shot`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: new Uint8Array(Buffer.concat(chunks)),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`TTS HTTP ${response.status}: ${detail.slice(0, 200)}`)
    }
    const pcm = Buffer.from(await response.arrayBuffer())
    if (pcm.length < WAV_HEADER_SIZE) throw new Error(`TTS empty audio (${pcm.length} bytes)`)

    const { mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(outDir, { recursive: true })
    const wavPath = join(outDir, outName)
    const fs = await import('node:fs')
    await fs.promises.writeFile(wavPath, wrapWav(pcm))
    return { wavPath, durationMs: Date.now() - startedAt, pcmBytes: pcm.length }
  }
}

/** 把 24kHz 16bit mono PCM 封装为 WAV（RIFF header） */
export function wrapWav(pcm: Buffer): Buffer {
  const sampleRate = 24000
  const channels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * channels * bitsPerSample / 8
  const blockAlign = channels * bitsPerSample / 8
  const dataSize = pcm.length
  const header = Buffer.alloc(WAV_HEADER_SIZE)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}
