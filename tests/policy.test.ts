import { describe, test, expect, vi } from 'vitest'
import { decide, isGroupChannel, inCooldown } from '../src/policy.js'

const cfg = {
  ttsEnabled: true,
  probability: 1, // 默认必配，测其它维度
  minLength: 4,
  maxLength: 100,
  cooldownSeconds: 120,
  groupOnly: true,
  onMentionOnly: false,
}

const opts = (over: Partial<Parameters<typeof decide>[1]> = {}) => ({
  text: '你好，我是 Mita！',
  channelId: 'group:628731557',
  mentioned: false,
  now: 1_000_000,
  lastSpeakAt: 0,
  ...over,
})

describe('policy.decide', () => {
  test('disabled → reject', () => {
    expect(decide({ ...cfg, ttsEnabled: false }, opts()).speak).toBe(false)
  })

  test('groupOnly & private channel → reject', () => {
    const d = decide(cfg, opts({ channelId: 'private:123' }))
    expect(d.speak).toBe(false)
    expect(d.reason).toBe('not-group')
  })

  test('onMentionOnly & not mentioned → reject', () => {
    const d = decide({ ...cfg, onMentionOnly: true }, opts({ mentioned: false }))
    expect(d.speak).toBe(false)
    expect(d.reason).toBe('not-mentioned')
  })

  test('too short / too long', () => {
    expect(decide(cfg, opts({ text: '短' })).reason).toBe('too-short')
    expect(decide(cfg, opts({ text: '长'.repeat(101) })).reason).toBe('too-long')
  })

  test('cooldown window blocks', () => {
    const d = decide(cfg, opts({ lastSpeakAt: 1_000_000 - 60_000 }))
    expect(d.speak).toBe(false)
    expect(d.reason).toBe('cooldown')
  })

  test('probability hit and miss', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(decide({ ...cfg, probability: 0.8 }, opts()).speak).toBe(true)
    expect(decide({ ...cfg, probability: 0.2 }, opts()).speak).toBe(false)
    vi.restoreAllMocks()
  })

  test('hit returns reason', () => {
    expect(decide(cfg, opts()).speak).toBe(true)
    expect(decide(cfg, opts()).reason).toBe('hit')
  })
})

describe('isGroupChannel / inCooldown', () => {
  test('group prefix', () => {
    expect(isGroupChannel('group:628731557')).toBe(true)
    expect(isGroupChannel('private:1')).toBe(false)
  })
  test('cooldown math', () => {
    expect(inCooldown(1000, 2000, 120)).toBe(true)
    expect(inCooldown(1000, 121_000, 120)).toBe(false)
  })
})
