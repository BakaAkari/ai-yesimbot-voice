import { Schema, Context } from 'koishi';

declare const name = "aka-yesimbot-voice";
/** 依赖 yesimbot service（必选：Koishi 保证在 yesimbot 注册后加载本插件） */
declare const inject: string[];
interface Config {
    /** 总开关 */
    ttsEnabled: boolean;
    /** 生效平台（onebot / lark） */
    platforms: string[];
    /** TTS 服务地址 */
    ttsApiBase: string;
    /** 音色 prompt_wav 本地路径（空 = 服务端默认音色） */
    voicePromptPath: string;
    /** instruct_text 朗读指令 */
    instructText: string;
    /** 合成超时 ms */
    ttsTimeoutMs: number;
    /** 输出目录 */
    outputDir: string;
    /** 每条回复配语音概率 */
    probability: number;
    /** 最短文本长度 */
    minLength: number;
    /** 最长文本长度 */
    maxLength: number;
    /** 同渠道冷却秒 */
    cooldownSeconds: number;
    /** 仅群聊 */
    groupOnly: boolean;
    /** 仅被 @ 时 */
    onMentionOnly: boolean;
    /** 发送失败时是否告警日志（不打扰用户） */
    logFailures: boolean;
}
declare const Config: Schema<Config>;
declare function apply(ctx: Context, config: Config): void;

export { Config, apply, inject, name };
