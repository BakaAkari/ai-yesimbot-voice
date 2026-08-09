import { describe, test, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { VoiceLibrary } from '../src/voices.js'

const TMP = '/tmp/aka-yesimbot-voice-voices-test'

function writeWav(name: string, size = 2048): void {
  writeFileSync(join(TMP, name), Buffer.alloc(size, 0x7f))
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})

describe('VoiceLibrary.scan', () => {
  test('returns sorted *.wav voices with name and path', () => {
    writeWav('leijun.wav')
    writeWav('gs_Collei.wav')
    writeWav('yuchengdong.wav')
    const lib = new VoiceLibrary(TMP)
    const list = lib.scan()
    expect(list.map((v) => v.name)).toEqual(['gs_Collei', 'leijun', 'yuchengdong'])
    expect(list[0]?.path).toBe(join(TMP, 'gs_Collei.wav'))
  })

  test('skips non-wav and tiny (corrupt/shell) files', () => {
    writeWav('good.wav')
    writeWav('bad.wav', 100) // <1KB → shell
    writeFileSync(join(TMP, 'note.txt'), 'hello')
    const list = new VoiceLibrary(TMP).scan()
    expect(list.map((v) => v.name)).toEqual(['good'])
  })

  test('empty or missing dir returns empty list', () => {
    rmSync(TMP, { recursive: true, force: true })
    expect(new VoiceLibrary(TMP).scan()).toEqual([])
  })
})

describe('VoiceLibrary.resolve', () => {
  test('auto returns first alphabetically', () => {
    writeWav('zz.wav')
    writeWav('aa.wav')
    const lib = new VoiceLibrary(TMP)
    expect(lib.resolve('auto')?.name).toBe('aa')
  })

  test('named voice resolves to match', () => {
    writeWav('leijun.wav')
    writeWav('gs_Collei.wav')
    const lib = new VoiceLibrary(TMP)
    expect(lib.resolve('leijun')?.name).toBe('leijun')
    expect(lib.resolve('gs_Collei')?.name).toBe('gs_Collei')
  })

  test('unknown name falls back to first', () => {
    writeWav('leijun.wav')
    writeWav('geping.wav')
    const lib = new VoiceLibrary(TMP)
    expect(lib.resolve('nonexistent')?.name).toBe('geping')
  })

  test('no voices → null', () => {
    expect(new VoiceLibrary(TMP).resolve('auto')).toBeNull()
    expect(new VoiceLibrary(TMP).resolve('leijun')).toBeNull()
  })
})
