import type { Logger } from 'koishi'
import type { LlmChannel } from './llm-channel.js'

export interface RenderOptions {
  /** LLM 通道；缺省 = 只跑规则层 */
  llm?: LlmChannel | null
  /** 内容保真阈值 0..1（LCS-based ratio）；LLM 输出低于此值回退规则层结果 */
  fidelityRatio: number
  /** LLM 后是否按规则插 [breath] */
  injectBreath: boolean
  /** LLM 调用超时 ms（透传给 channel.rewrite） */
  timeoutMs: number
  /** prompt 模板；含 {text} 占位符 */
  prompt: string
  /** 调试：日志输出改写前后（不含 key） */
  logPrompts?: boolean
  logger?: Pick<Logger, 'info' | 'warn'> | null
}

export interface RenderResult {
  /** 最终喂给 TTS 的文本 */
  text: string
  /** 内容保真 ratio（0..1）；无 LLM 通道或 LLM 未产出时为 1 */
  ratio: number
  /** 最终文本来源：rules（规则层）/ llm（LLM 通过保真校验） */
  source: 'rules' | 'llm'
  /** LLM 尝试过但被拒绝/失败 */
  degraded: boolean
  /** degraded 原因（fidelity / timeout / empty / <error message>） */
  reason?: string
}

/**
 * 语音效果渲染管线：
 * 规则层 → LLM 层（可选）→ 保真校验 → [breath] 注入
 * 任何异常都降级到规则层结果，绝不抛错。
 */
export async function render(input: string, opts: RenderOptions): Promise<RenderResult> {
  const rules = ruleLayer(input)
  if (!opts.llm) {
    const text = opts.injectBreath ? injectBreath(rules) : rules
    return { text, ratio: 1, source: 'rules', degraded: false }
  }

  let raw: string | null = null
  let failReason: string | undefined
  try {
    raw = await opts.llm.rewrite(rules, opts.prompt, opts.timeoutMs)
  } catch (err) {
    failReason = err instanceof Error ? err.message : String(err)
    raw = null
  }

  if (opts.logPrompts && opts.logger) {
    opts.logger.info(
      'llm prompt in=%s out=%s',
      rules.slice(0, 80),
      (raw ?? '<null>').slice(0, 80),
    )
  }

  const trimmed = raw?.trim() ?? ''
  if (!trimmed) {
    if (failReason && opts.logger) opts.logger.warn('llm rewrite failed: %s', failReason)
    const text = opts.injectBreath ? injectBreath(rules) : rules
    return { text, ratio: 1, source: 'rules', degraded: true, reason: failReason ?? 'empty' }
  }

  const ratio = fidelityRatio(rules, trimmed)
  if (ratio < opts.fidelityRatio) {
    const text = opts.injectBreath ? injectBreath(rules) : rules
    return { text, ratio, source: 'rules', degraded: true, reason: 'fidelity' }
  }

  const text = opts.injectBreath ? injectBreath(trimmed) : trimmed
  return { text, ratio, source: 'llm', degraded: false }
}

/**
 * 规则层：轻量、常开、不改变语义。
 * 复刻 cosyvoice3_preprocess 规则层子集：空白/标点归一化、CJK-Latin 边界空格、句末标点补全。
 */
export function ruleLayer(text: string): string {
  if (!text) return ''
  let s = text.replace(/\r\n?/g, '\n').trim()
  // 空格/制表符折叠（保留换行）
  s = s.replace(/[ \t]+/g, ' ')
  // 相邻重复终止标点合并（！！！ → ！；?? → ?）
  s = s.replace(/([。！？!?])\1+/g, '$1')
  // 相邻重复逗号合并
  s = s.replace(/([，,、;；])\1+/g, '$1')
  // CJK 与 Latin/数字之间加空格
  s = s.replace(/([一-龥])([A-Za-z0-9])/g, '$1 $2')
  s = s.replace(/([A-Za-z0-9])([一-龥])/g, '$1 $2')
  // 句末补终止标点
  if (s) {
    const tail = s.slice(-1)
    if (!/[。！？!?…\.]/.test(tail)) {
      if (/[一-龥]/.test(tail)) s += '。'
      else if (/[A-Za-z0-9]/.test(tail)) s += '.'
    }
  }
  return s
}

/**
 * 内容保真 ratio：抽取中文字符序列（其它字符忽略），
 * 用最长公共子序列（LCS）算 SequenceMatcher-style ratio = 2*LCS/(|a|+|b|)。
 * 中文字符全无时（纯英文）退化为整体字符 LCS。
 */
export function fidelityRatio(a: string, b: string): number {
  const [aa, bb] = pickCharSeq(a, b)
  if (!aa.length && !bb.length) return 1
  if (!aa.length || !bb.length) return 0
  const lcs = lcsLength(aa, bb)
  return (2 * lcs) / (aa.length + bb.length)
}

function pickCharSeq(a: string, b: string): [string, string] {
  const ac = a.match(/[一-龥]/g)?.join('') ?? ''
  const bc = b.match(/[一-龥]/g)?.join('') ?? ''
  if (ac || bc) return [ac, bc]
  // 纯拉丁场景：去掉空格/韵律标记后按字符比对
  const strip = (s: string) => s.replace(/\[[a-zA-Z_]+\]/g, '').replace(/\s+/g, '').toLowerCase()
  return [strip(a), strip(b)]
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m || !n) return 0
  let prev: number[] = new Array<number>(n + 1).fill(0)
  let curr: number[] = new Array<number>(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const pj = prev[j] ?? 0
      const cj1 = curr[j - 1] ?? 0
      if (a[i - 1] === b[j - 1]) curr[j] = (prev[j - 1] ?? 0) + 1
      else curr[j] = pj >= cj1 ? pj : cj1
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  return prev[n] ?? 0
}

const BREATH_MARK_RE = /\[(breath|quick_breath|sigh|laughter|cough|noise)\]\s*$/

/**
 * [breath] 韵律注入：在句子之间插入换气标记。
 * - 少于 3 个句子 → 不插（避免过度）
 * - 已有韵律标记结尾 → 跳过
 * - 最后一段末尾不插
 */
export function injectBreath(text: string): string {
  if (!text) return ''
  const parts: string[] = []
  const re = /[^。！？!?]+[。！？!?]?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) parts.push(m[0])
  }
  if (parts.length < 3) return text
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i] ?? ''
    out.push(seg)
    if (i === parts.length - 1) continue
    if (BREATH_MARK_RE.test(seg)) continue
    // 若段落已以标点结束，则韵律标记贴在标点后
    out.push('[breath]')
  }
  return out.join('')
}
