import { h, type Bot } from 'koishi'

/**
 * 构造语音元素并发送。
 * - onebot/QQ：record 元素（NapCat 转码 amr）
 * - lark/飞书：audio 元素
 * src 必须用 file:// 协议触发 Koishi assets 机制（跨容器文件可达），
 * 否则裸路径会被 NapCat 当作自身文件系统路径，读取失败静默丢弃。
 */
export async function sendVoice(bot: Bot, channelId: string, wavPath: string, platform: string): Promise<void> {
  const src = `file://${wavPath}`
  const element = platform === 'lark'
    ? h('audio', { src })
    : h('record', { src })
  await bot.sendMessage(channelId, [element])
}
