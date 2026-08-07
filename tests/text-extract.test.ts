import { describe, test, expect } from 'vitest'
import { extractReplyText } from '../src/text-extract.js'

const base = { id: 'm1', timestamp: 0, role: 'user' as const }

describe('extractReplyText', () => {
  test('string content from assistant message', () => {
    const messages = [
      { ...base, role: 'user', content: 'hi' },
      { ...base, role: 'assistant', content: '  你好，我是 Mita。  ' },
    ]
    expect(extractReplyText(messages)).toBe('你好，我是 Mita。')
  })

  test('text parts array content', () => {
    const messages = [
      { ...base, role: 'assistant', content: [
        { type: 'text', text: '第一段' },
        { type: 'image', image: new Uint8Array() },
        { type: 'text', text: '第二段' },
      ] },
    ]
    expect(extractReplyText(messages)).toBe('第一段\n第二段')
  })

  test('ignores tool/custom messages', () => {
    const messages = [
      { ...base, role: 'tool', content: 'tool result' },
      { ...base, role: 'assistant', content: '' },
    ]
    expect(extractReplyText(messages)).toBe('')
  })

  test('empty / null / undefined input', () => {
    expect(extractReplyText(undefined)).toBe('')
    expect(extractReplyText(null)).toBe('')
    expect(extractReplyText([])).toBe('')
  })

  test('strips <message> wrapper tags', () => {
    const messages = [
      { ...base, role: 'assistant', content: '<message>没有这功能，别惦记了</message>' },
    ]
    expect(extractReplyText(messages)).toBe('没有这功能，别惦记了')
  })

  test('takes first non-empty assistant message', () => {
    const messages = [
      { ...base, role: 'assistant', content: '' },
      { ...base, role: 'assistant', content: 'second' },
    ]
    expect(extractReplyText(messages)).toBe('second')
  })
})
