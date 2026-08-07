import { h, type Bot } from 'koishi'

/**
 * 构造语音元素并发送。
 * - onebot/QQ：record 元素（NapCat 转码 amr）
 * - lark/飞书：audio 元素
 */
export async function sendVoice(bot: Bot, channelId: string, wavPath: string, platform: string): Promise<void> {
  const element = platform === 'lark'
    ? h('audio', { src: wavPath })
    : h('record', { src: wavPath })
  await bot.sendMessage(channelId, [element])
}
