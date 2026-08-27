import type { Logger } from 'koishi'

export interface TtsClientConfig {
  apiBase: string
  /** 请求超时 ms */
  timeoutMs: number
  /** 合成语速（CV3 规范推荐 1.2；传给 /inference_zero_shot 的 speed 字段） */
  speed?: number
  /** 合成后调服务端 /loudnorm 归一化到 -20 LUFS；端点不可用/失败时静默降级返回原 PCM */
  loudnorm?: boolean
  /**
   * 合成 WAV 末尾追加的静音时长 ms。
   * 背景：CosyVoice3 在 stop token 处硬切、无尾静音，且 QQ 语音经 Silk/AMR 帧编码，
   * 末尾无静音缓冲时最后一帧语音会被吞掉 → 播放时末尾 1-2 字被截断。
   * 追加一段尾部静音给编码器留缓冲帧即可避免。0 = 不填充。
   */
  tailPadMs: number
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
  /** 原始 PCM 字节数（响度归一化后） */
  pcmBytes: number
  /** 是否实际应用了服务端 /loudnorm 响度归一化（false=端点不可用或失败已降级） */
  loudnormApplied?: boolean
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

    // zero_shot：prompt_text = "You are a helpful assistant.<|endofprompt|>" + 参考音频转写。
    // ⚠️ 实测必须带 "You are a helpful assistant.<|endofprompt|>" 前置（2026-08-28 复现验证）：
    // 缺此前缀时，模型会把参考转写当作正文回显混入（如把 halo 长转写尾巴念出来 → 音频明显变长）。
    // 服务端只自动补结尾 <|endofprompt|>，不补开头前置，故这里必须显式加。
    const rawTranscript = (voice?.transcript ?? '').trim()
    const promptText = rawTranscript ? `You are a helpful assistant.<|endofprompt|>${rawTranscript}` : ''
    const pushField = (name: string, value: string) => {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
    pushField('tts_text', text)
    pushField('prompt_text', promptText)
    pushField('speed', String(this.config.speed ?? 1.2))
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
    let pcm = Buffer.from(await response.arrayBuffer()) as Buffer
    if (pcm.length < WAV_HEADER_SIZE) throw new Error(`TTS empty audio (${pcm.length} bytes)`)

    // 响度归一化（可选）：调服务端 /loudnorm 归一化到 -20 LUFS（TP -2 / LRA 11）。
    // 端点不可用或失败时静默降级返回原 PCM（不阻断合成），由 TtsSynthesisResult.loudnormApplied 标记实际是否应用。
    let loudnormApplied = false
    if (this.config.loudnorm) {
      const ln = await this.applyLoudnorm(pcm)
      pcm = ln.pcm
      loudnormApplied = ln.applied
    }

    const { mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(outDir, { recursive: true })
    const wavPath = join(outDir, outName)
    const fs = await import('node:fs')
    await fs.promises.writeFile(wavPath, wrapWav(pcm, this.config.tailPadMs))
    return { wavPath, durationMs: Date.now() - startedAt, pcmBytes: pcm.length, loudnormApplied }
  }

  /**
   * 调服务端 /loudnorm，把 24kHz mono s16 PCM 归一化到 -20 LUFS。
   * 失败（网络/非 2xx/返回过小）返回 { pcm: 原样, applied: false }，绝不抛错。
   */
  private async applyLoudnorm(pcm: Buffer): Promise<{ pcm: Buffer; applied: boolean }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const res = await this.fetchLike(`${this.config.apiBase.replace(/\/+$/, '')}/loudnorm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(pcm.length),
        },
        body: new Uint8Array(pcm),
        signal: controller.signal,
      })
      if (!res.ok) return { pcm, applied: false }
      const out = Buffer.from(await res.arrayBuffer())
      if (out.length < WAV_HEADER_SIZE) return { pcm, applied: false }
      return { pcm: out, applied: true }
    } catch {
      return { pcm, applied: false }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 把 24kHz 16bit mono PCM 封装为 WAV（RIFF header），末尾可追加静音缓冲 */
export function wrapWav(pcm: Buffer, tailPadMs = 0): Buffer {
  const sampleRate = 24000
  const channels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * channels * bitsPerSample / 8
  const blockAlign = channels * bitsPerSample / 8
  // 尾部静音填充：给 Silk/AMR 帧编码留缓冲帧，避免末尾音节被吞（默认 0 保持原行为）
  const tailPadSamples = Math.max(0, Math.round((tailPadMs / 1000) * sampleRate))
  const tailPadBytes = tailPadSamples * channels * bitsPerSample / 8
  const dataSize = pcm.length + tailPadBytes
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
  // 零填充（静音）
  const tail = Buffer.alloc(tailPadBytes)
  return Buffer.concat([header, pcm, tail])
}
