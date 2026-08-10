import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TtsVoiceSource } from './tts-client.js'

export interface VoiceInfo extends TtsVoiceSource {
  /** 音色名 = 文件名去 .wav 扩展名，如 leijun / gs_Collei */
  name: string
  /** wav 绝对路径 */
  path: string
  /** 该音色参考音频的真实转写（zero_shot 的 prompt_text），来自同名 <name>.txt 或 ref_transcript.txt */
  transcript?: string
}

/**
 * 读取音色对应的转写：优先 <name>.txt（与 wav 同名），回退 ref_transcript.txt。
 * 返回去除首尾空白后的文本；无文件/读取失败返回 undefined。
 */
function readVoiceTranscript(dir: string, baseName: string): string | undefined {
  const candidates = [`${baseName}.txt`, 'ref_transcript.txt']
  for (const c of candidates) {
    try {
      const content = readFileSync(join(dir, c), 'utf8').trim()
      if (content) return content
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return undefined
}

/**
 * 音色库：扫描一个目录里的 *.wav 作为可用音色。
 * - 每个音色 = 一个 .wav (+ 可选同名 .txt 转写)；放/删文件即增删音色（重启插件生效）
 * - 转写文件缺失该音色仍可用，只是 zero_shot 条件对齐弱（transcript 为空）
 * - 空壳/损坏/过小文件防御性跳过（<1KB 视为无效）
 * - 按文件名排序稳定（auto 取第一个）
 */
export class VoiceLibrary {
  constructor(private readonly dir: string) {}

  /** 扫描并返回全部可用音色（已按名字排序）；目录不存在/不可读返回空数组 */
  scan(): VoiceInfo[] {
    let entries: string[]
    try {
      entries = readdirSync(this.dir)
    } catch {
      return []
    }
    const voices: VoiceInfo[] = []
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.wav')) continue
      const baseName = entry.slice(0, -4)
      const path = join(this.dir, entry)
      try {
        if (statSync(path).size < 1024) continue // 空壳/损坏
      } catch {
        continue
      }
      voices.push({
        name: baseName,
        path,
        transcript: readVoiceTranscript(this.dir, baseName),
      })
    }
    voices.sort((a, b) => a.name.localeCompare(b.name))
    return voices
  }

  /**
   * 按配置解析当前音色：
   * - 'auto' → 扫描结果第一个（无则 null）
   * - 具名 → 匹配该音色；不存在 → 回退第一个
   * 始终基于最新扫描结果；目录无音色返回 null。
   */
  resolve(voice: string): VoiceInfo | null {
    const voices = this.scan()
    if (!voices.length) return null
    if (voice && voice !== 'auto') {
      const found = voices.find((v) => v.name === voice)
      if (found) return found
    }
    return voices[0] ?? null
  }
}
