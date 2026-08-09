import { Schema, Context } from 'koishi';

declare const name = "aka-yesimbot-voice";
/** 依赖 yesimbot service（必选：Koishi 保证在 yesimbot 注册后加载本插件） */
declare const inject: string[];
/**
 * 极简配置模型（v0.3.0 重构，无旧字段兼容负担）。
 * - 基础：音色、触发概率、LLM 渲染开关、音色源目录
 * - advanced：不常改的默认值折叠隐藏
 */
interface Config {
    /** 音色名；'auto' = 音色目录按字母序第一个 */
    voice: string;
    /** 每条回复配语音概率 0-1 */
    probability: number;
    /** LLM 语音效果渲染（走 yesimbot 主模型通道；失败自动降级规则层） */
    llm: boolean;
    /** 音色源目录：管理员放/删 *.wav 即增删音色（重启生效） */
    voiceDir: string;
    advanced: {
        /** CosyVoice3 服务地址 */
        ttsApiBase: string;
        /** 朗读指令（中英混排） */
        instructText: string;
        /** 合成超时 ms */
        ttsTimeoutMs: number;
        /** 最短触发文本长度（字符） */
        minLength: number;
        /** 最长触发文本长度（字符），超过不配（避免长文朗读） */
        maxLength: number;
        /** 同渠道冷却秒 */
        cooldownSeconds: number;
        /** 仅群聊配语音 */
        groupOnly: boolean;
        /** 仅被 @ 时配语音 */
        onMentionOnly: boolean;
        /** 命中时吞掉 yesimbot 文本只发语音（TTS 失败自动补发文本） */
        replaceText: boolean;
        /** NapCat HTTP API（QQ 语音直发） */
        napcatHttpUrl: string;
    };
}
declare const Config: Schema<Config>;
declare function apply(ctx: Context, config: Config): void;

export { Config, apply, inject, name };
