import type { Logger } from 'koishi'

export interface TtsClientConfig {
  apiBase: string
  /** 请求超时 ms */
  timeoutMs: number
  /** 音色 prompt_wav 的本地路径（文件内容随请求上传） */
  voicePromptPath: string
  /** instruct_text：朗读指令（中英混排修复方案的核心） */
  instructText: string
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
 * CosyVoice3 /inference_instruct2 客户端。
 * 请求：multipart（tts_text / instruct_text / prompt_wav）
 * 响应：raw 24kHz 16bit mono PCM → 本地封装 WAV 头。
 * 失败抛错（由调用方静默降级）。
 */
export class TtsClient {
  constructor(
    private readonly config: TtsClientConfig,
    private readonly fetchLike: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async synthesize(text: string, outDir: string, outName = 'voice.wav'): Promise<TtsSynthesisResult> {
    const startedAt = Date.now()
    const { apiBase, timeoutMs, voicePromptPath, instructText } = this.config
    const boundary = `----akaTts${Date.now()}${Math.random().toString(16).slice(2)}`
    const chunks: Buffer[] = []

    // instruct2 端点强制要求 instruct_text 含 <|endofprompt|>，缺失会触发服务端断言失败（LLM 空 token）。
    const safeInstruct = instructText.includes('<|endofprompt|>') ? instructText : `${instructText.trim()}<|endofprompt|>`
    const pushField = (name: string, value: string) => {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
    pushField('tts_text', text)
    pushField('instruct_text', safeInstruct)
    if (voicePromptPath) {
      const fs = await import('node:fs')
      const audio = await fs.promises.readFile(voicePromptPath)
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt_wav"; filename="prompt.wav"\r\nContent-Type: audio/wav\r\n\r\n`))
      chunks.push(audio)
      chunks.push(Buffer.from('\r\n'))
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await this.fetchLike(`${apiBase}/inference_instruct2`, {
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
