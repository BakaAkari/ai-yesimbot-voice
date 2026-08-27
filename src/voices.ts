import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TtsVoiceSource } from './tts-client.js'

/** CV3 音源库 meta.json（展示/来源/语言，可选） */
export interface VoiceMeta {
  cn_name?: string
  en_name?: string
  source?: string
  status?: string
  langs?: string[]
  note?: string
}

/** CV3 音源库 prompt_template.json（persona / 语气 / 写作引导，可选） */
export interface VoicePromptTemplate {
  persona?: string
  speech_style?: { rhythm?: string; punctuation?: string }
  style_notes?: string
  writing_guide?: string
  verified_example?: string
}

export interface VoiceInfo extends TtsVoiceSource {
  /** 音色名 = 文件名去 .wav 扩展名（扁平）或子目录名（CV3 结构），如 leijun / gs_Collei */
  name: string
  /** 参考音频 wav 绝对路径 */
  path: string
  /** 该音色参考音频的真实转写（zero_shot 的 prompt_text） */
  transcript?: string
  /** CV3 音源库元数据（meta.json，可选） */
  meta?: VoiceMeta
  /** CV3 音源库 prompt_template.json（可选） */
  promptTemplate?: VoicePromptTemplate
  /** 由 prompt_template.json 派生的朗读风格描述（注入 LLM 改写层的 persona/节奏/写作引导） */
  stylePrompt?: string
}

/** 读取 json 文件，解析失败/缺失返回 undefined */
function readJson(dir: string, fileName: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, fileName), 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** 读取单文件文本（缺失/失败返回 undefined） */
function readText(dir: string, fileName: string): string | undefined {
  try {
    const content = readFileSync(join(dir, fileName), 'utf8').trim()
    return content || undefined
  } catch {
    return undefined
  }
}

/** 读取音色对应的转写：优先 <name>.txt / ref_transcript.txt。 */
function readVoiceTranscript(dir: string, baseName: string): string | undefined {
  const candidates = [`${baseName}.txt`, 'ref_transcript.txt']
  for (const c of candidates) {
    const content = readText(dir, c)
    if (content) return content
  }
  return undefined
}

/** 从 prompt_template.json 派生朗读风格描述（供 LLM 改写层注入 persona/节奏/写作引导）。 */
function deriveStylePrompt(vt?: VoicePromptTemplate): string | undefined {
  if (!vt) return undefined
  const parts: string[] = []
  if (vt.persona) parts.push(`人设：${vt.persona}`)
  if (vt.speech_style?.rhythm) parts.push(`节奏：${vt.speech_style.rhythm}`)
  if (vt.speech_style?.punctuation) parts.push(`标点：${vt.speech_style.punctuation}`)
  if (vt.style_notes) parts.push(vt.style_notes)
  if (vt.writing_guide) parts.push(vt.writing_guide)
  return parts.length ? parts.join('\n') : undefined
}

/**
 * 音色库：扫描一个目录里的音色，兼容两种格式：
 * - 扁平：`<name>.wav`（+ 可选 `<name>.txt` / `<name>.meta.json` / `<name>.prompt_template.json`）
 * - CV3 子目录：`<name>/ref.wav`（+ `ref_transcript.txt` / `meta.json` / `prompt_template.json`）
 * 放/删文件即增删音色（重启插件生效）；空壳/损坏/过小文件防御性跳过（<1KB 视为无效）。
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
      const full = join(this.dir, entry)
      // CV3 子目录结构：<name>/ref.wav
      let stats: ReturnType<typeof statSync> | undefined
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      let info: VoiceInfo | undefined
      if (stats.isDirectory()) {
        if (!existsRefWav(full)) continue
        const promptTemplate = readJson(full, 'prompt_template.json') as VoicePromptTemplate | undefined
        info = {
          name: entry,
          path: join(full, 'ref.wav'),
          transcript: readVoiceTranscript(full, 'ref'),
          meta: readJson(full, 'meta.json') as VoiceMeta | undefined,
          promptTemplate,
          stylePrompt: deriveStylePrompt(promptTemplate),
        }
      } else if (entry.toLowerCase().endsWith('.wav')) {
        if (stats.size < 1024) continue
        const baseName = entry.slice(0, -4)
        const promptTemplate = readJson(this.dir, `${baseName}.prompt_template.json`) as VoicePromptTemplate | undefined
        info = {
          name: baseName,
          path: full,
          transcript: readVoiceTranscript(this.dir, baseName),
          meta: readJson(this.dir, `${baseName}.meta.json`) as VoiceMeta | undefined,
          promptTemplate,
          stylePrompt: deriveStylePrompt(promptTemplate),
        }
      }
      if (info) voices.push(info)
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

function existsRefWav(dir: string): boolean {
  try {
    return statSync(join(dir, 'ref.wav')).isFile()
  } catch {
    return false
  }
}
