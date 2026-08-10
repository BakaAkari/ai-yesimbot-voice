import { describe, test, expect, vi } from 'vitest'
import { render, ruleLayer, fidelityRatio, injectBreath, stripProsodyMarkers } from '../src/preprocess.js'
import type { LlmChannel } from '../src/llm-channel.js'

const baseOpts = {
  fidelityRatio: 0.95,
  injectBreath: false,
  timeoutMs: 30000,
  prompt: '改写：{text}',
}

function fakeChannel(fn: (text: string, tpl: string) => Promise<string>): LlmChannel {
  return { source: 'custom', rewrite: (t, tpl) => fn(t, tpl) }
}

describe('ruleLayer', () => {
  test('trims + collapses whitespace + normalizes duplicate punctuation', () => {
    expect(ruleLayer('  你好  世界！！！ ')).toBe('你好 世界！')
  })
  test('inserts space between CJK and Latin/digits', () => {
    expect(ruleLayer('好的hello world')).toBe('好的 hello world.')
    expect(ruleLayer('测试3次')).toBe('测试 3 次。')
  })
  test('adds sentence-final punctuation only when missing', () => {
    expect(ruleLayer('你好')).toBe('你好。')
    expect(ruleLayer('hi')).toBe('hi.')
    expect(ruleLayer('你好。')).toBe('你好。')
    expect(ruleLayer('你好…')).toBe('你好…')
  })
  test('empty stays empty', () => {
    expect(ruleLayer('')).toBe('')
    expect(ruleLayer('   ')).toBe('')
  })
})

describe('fidelityRatio', () => {
  test('identical CJK → 1', () => {
    expect(fidelityRatio('你好世界', '你好世界。')).toBe(1)
  })
  test('paraphrase but same core → high', () => {
    expect(fidelityRatio('这是一个测试', '这是一个测试哦')).toBeGreaterThanOrEqual(0.9)
  })
  test('mostly different → low', () => {
    expect(fidelityRatio('你好世界', '完全不同的内容')).toBeLessThan(0.5)
  })
  test('empty both → 1', () => {
    expect(fidelityRatio('', '')).toBe(1)
  })
  test('pure latin uses char LCS fallback', () => {
    expect(fidelityRatio('hello world', 'hello world!')).toBeGreaterThanOrEqual(0.9)
  })
})

describe('injectBreath', () => {
  test('<3 sentences → unchanged', () => {
    expect(injectBreath('你好。世界。')).toBe('你好。世界。')
  })
  test('≥3 sentences → inserts between', () => {
    const out = injectBreath('第一句。第二句。第三句。')
    expect(out.match(/\[breath\]/g)).toHaveLength(2)
    expect(out.endsWith('第三句。')).toBe(true)
  })
  test('skips segments already ending with a prosody marker', () => {
    const out = injectBreath('先来一段。[laughter]再一段。收尾一下。')
    // Should not double-mark the [laughter] tail
    const marks = out.match(/\[breath\]/g) ?? []
    expect(marks.length).toBeLessThanOrEqual(2)
  })
  test('empty stays empty', () => {
    expect(injectBreath('')).toBe('')
  })
})

describe('render — no LLM channel', () => {
  test('returns rules layer output, source=rules', async () => {
    const r = await render('你好 world', { ...baseOpts })
    expect(r.source).toBe('rules')
    expect(r.degraded).toBe(false)
    expect(r.text).toContain('你好')
    expect(r.text).toContain('world')
  })

  test('injectBreath=true adds breath marks when ≥3 sentences', async () => {
    const r = await render('第一。第二。第三。', { ...baseOpts, injectBreath: true })
    // zero_shot：即使注入了 [breath]，最终文本也会被统一剥除，避免模型提前截断
    expect(r.text).not.toContain('[breath]')
  })

  test('LLM output with [breath]/[laughter] markers is stripped', async () => {
    const ch = fakeChannel(async () => '嗯，先稳住。[breath] 明天啊。[laughter]')
    const r = await render('嗯，先稳住。明天啊。', { ...baseOpts, llm: ch, injectBreath: true })
    expect(r.text).not.toContain('[breath]')
    expect(r.text).not.toContain('[laughter]')
    expect(r.text).toContain('先稳住')
    expect(r.text).toContain('明天啊')
  })
})

describe('stripProsodyMarkers', () => {
  test('removes latin bracket markers', () => {
    expect(stripProsodyMarkers('先。[breath]后。')).toBe('先。后。')
    expect(stripProsodyMarkers('哈哈[laughter]')).toBe('哈哈')
    expect(stripProsodyMarkers('嗯。[sigh]')).toBe('嗯。')
  })
  test('removes CJK bracket markers', () => {
    expect(stripProsodyMarkers('先。[笑声]后。')).toBe('先。后。')
    expect(stripProsodyMarkers('先。[停顿]再。')).toBe('先。再。')
    expect(stripProsodyMarkers('[轻声]别激动')).toBe('别激动')
  })
  test('removes multi-word and consecutive markers', () => {
    expect(stripProsodyMarkers('先。[quick_breath]后。')).toBe('先。后。')
    expect(stripProsodyMarkers('先。[breath][laugh]后。')).toBe('先。后。')
    expect(stripProsodyMarkers('先 [slow] 后')).toBe('先 后')
  })
  test('cleans leftover whitespace before punctuation', () => {
    expect(stripProsodyMarkers('明天啊。 [breath] 那就这样吧。')).toBe('明天啊。那就这样吧。')
    expect(stripProsodyMarkers('  [breath]  你好  ')).toBe('你好')
  })
  test('keeps normal brackets and text', () => {
    expect(stripProsodyMarkers('你好（世界）')).toBe('你好（世界）')
    expect(stripProsodyMarkers('')).toBe('')
    expect(stripProsodyMarkers('a · b')).toBe('a · b')
  })
})

describe('render — LLM channel', () => {
  test('LLM null/empty → degraded, falls back to rules', async () => {
    const ch = fakeChannel(async () => '')
    const r = await render('你好', { ...baseOpts, llm: ch })
    expect(r.source).toBe('rules')
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('empty')
  })

  test('LLM throws → degraded with error reason', async () => {
    const ch = fakeChannel(async () => {
      throw new Error('boom')
    })
    const r = await render('你好', { ...baseOpts, llm: ch })
    expect(r.source).toBe('rules')
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('boom')
  })

  test('fidelity passes → LLM result used', async () => {
    const original = '你好世界，我是Mita'
    const ch = fakeChannel(async () => '你好，世界！我是 Mita [breath] 很高兴见到你。')
    const r = await render(original, { ...baseOpts, llm: ch, fidelityRatio: 0.5 })
    expect(r.source).toBe('llm')
    expect(r.degraded).toBe(false)
    expect(r.text).toContain('Mita')
  })

  test('fidelity below threshold → rejected, falls back to rules', async () => {
    const ch = fakeChannel(async () => '完全跑题了的另一段内容。')
    const r = await render('你好世界这是原文', { ...baseOpts, llm: ch, fidelityRatio: 0.95 })
    expect(r.source).toBe('rules')
    expect(r.degraded).toBe(true)
    expect(r.reason).toBe('fidelity')
  })

  test('injectBreath applied after LLM output', async () => {
    const ch = fakeChannel(async () => '第一句。第二句。第三句。')
    const r = await render('第一。第二。第三。', { ...baseOpts, llm: ch, fidelityRatio: 0.5, injectBreath: true })
    expect(r.source).toBe('llm')
    // zero_shot：最终文本统一剥除 [breath] 等标记，避免模型提前截断
    expect(r.text).not.toContain('[breath]')
  })

  test('logPrompts uses logger.info', async () => {
    const info = vi.fn()
    const warn = vi.fn()
    const ch = fakeChannel(async (t) => t)
    await render('你好', { ...baseOpts, llm: ch, logPrompts: true, logger: { info, warn } as any })
    expect(info).toHaveBeenCalled()
  })
})
