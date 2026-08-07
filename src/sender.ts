import { h, type Bot } from 'koishi'
import { readFileSync } from 'fs'

/**
 * 发送语音。
 *
 * QQ/onebot 主路径：直调 NapCat HTTP API（`napcatHttpUrl`）。
 *  - 跨容器 base64:// 传 WAV，NapCat 自动转 amr 上传 QQ CDN。
 *  - 背景：Koishi bot.sendMessage(record) 在 onebot 适配器下是"假成功"——
 *    NapCat 侧无任何消息记录（get_group_msg_history 查无 record），不可用。
 *  - 2026-08-07 已验证：POST {base}/send_group_msg + record base64 → get_msg 复核
 *    message_id + record 类型 + 群号全部正确。
 *
 * 回退路径：未配置 napcatHttpUrl（本地开发）或非 onebot 平台 → Koishi 元素发送。
 *  - lark：audio 元素；onebot：record 元素（保留，但仅作回退）。
 */
export async function sendVoice(
  bot: Bot,
  channelId: string,
  wavPath: string,
  platform: string,
  napcatHttpUrl?: string,
): Promise<void> {
  if (platform === 'onebot' && napcatHttpUrl) {
    await sendViaNapcat(napcatHttpUrl, channelId, wavPath)
    return
  }
  const src = `file://${wavPath}`
  const element = platform === 'lark' ? h('audio', { src }) : h('record', { src })
  await bot.sendMessage(channelId, [element])
}

async function sendViaNapcat(baseUrl: string, channelId: string, wavPath: string): Promise<void> {
  const b64 = readFileSync(wavPath).toString('base64')
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/send_group_msg`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      group_id: Number(channelId),
      message: [{ type: 'record', data: { file: `base64://${b64}` } }],
    }),
  })
  if (!res.ok) {
    throw new Error(`NapCat HTTP ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { status?: string; retcode?: number; message?: string }
  if (data.status !== 'ok' || data.retcode !== 0) {
    throw new Error(`NapCat send_group_msg failed: ${data.message ?? 'unknown'}`)
  }
}
