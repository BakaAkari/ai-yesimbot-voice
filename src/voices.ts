import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface VoiceInfo {
  /** 音色名 = 文件名去 .wav 扩展名，如 leijun / gs_Collei */
  name: string
  /** wav 绝对路径 */
  path: string
}

/**
 * 音色库：扫描一个目录里的 *.wav 作为可用音色。
 * - 管理员增删音色 = 往目录放/删 wav 文件（重启插件生效）
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
      const path = join(this.dir, entry)
      try {
        if (statSync(path).size < 1024) continue // 空壳/损坏
      } catch {
        continue
      }
      voices.push({ name: entry.slice(0, -4), path })
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
