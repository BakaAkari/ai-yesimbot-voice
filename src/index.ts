import { Context, Schema } from 'koishi'

export const name = 'aka-yesimbot-tts'

export interface Config {
  message: string
}

export const Config: Schema<Config> = Schema.object({
  message: Schema.string().default('hello from koishi-plugin-aka-yesimbot-tts'),
})

export function apply(ctx: Context, config: Config) {
  ctx.logger(name).info(config.message)
}
