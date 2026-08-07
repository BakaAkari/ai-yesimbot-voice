"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_koishi2 = require("koishi");

// src/tts-client.ts
var WAV_HEADER_SIZE = 44;
var TtsClient = class {
  constructor(config, fetchLike = globalThis.fetch.bind(globalThis)) {
    this.config = config;
    this.fetchLike = fetchLike;
  }
  async synthesize(text, outDir, outName = "voice.wav") {
    const startedAt = Date.now();
    const { apiBase, timeoutMs, voicePromptPath, instructText } = this.config;
    const boundary = `----akaTts${Date.now()}${Math.random().toString(16).slice(2)}`;
    const chunks = [];
    const safeInstruct = instructText.includes("<|endofprompt|>") ? instructText : `${instructText.trim()}<|endofprompt|>`;
    const pushField = (name2, value) => {
      chunks.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="${name2}"\r
\r
${value}\r
`));
    };
    pushField("tts_text", text);
    pushField("instruct_text", safeInstruct);
    if (voicePromptPath) {
      const fs2 = await import("fs");
      const audio = await fs2.promises.readFile(voicePromptPath);
      chunks.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="prompt_wav"; filename="prompt.wav"\r
Content-Type: audio/wav\r
\r
`));
      chunks.push(audio);
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r
`));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this.fetchLike(`${apiBase}/inference_instruct2`, {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body: new Uint8Array(Buffer.concat(chunks)),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`TTS HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }
    const pcm = Buffer.from(await response.arrayBuffer());
    if (pcm.length < WAV_HEADER_SIZE) throw new Error(`TTS empty audio (${pcm.length} bytes)`);
    const { mkdir } = await import("fs/promises");
    const { join } = await import("path");
    await mkdir(outDir, { recursive: true });
    const wavPath = join(outDir, outName);
    const fs = await import("fs");
    await fs.promises.writeFile(wavPath, wrapWav(pcm));
    return { wavPath, durationMs: Date.now() - startedAt, pcmBytes: pcm.length };
  }
};
function wrapWav(pcm) {
  const sampleRate = 24e3;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

// src/text-extract.ts
function extractReplyText(messages) {
  if (!Array.isArray(messages)) return "";
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const content = message.content;
    const text = contentToText(content);
    if (text) return text;
  }
  return "";
}
function contentToText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (part && typeof part === "object" && part.type === "text") {
      const text = part.text;
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n").trim();
}

// src/policy.ts
function isGroupChannel(channelId) {
  return channelId.startsWith("group:");
}
function decide(cfg, opts) {
  if (!cfg.ttsEnabled) return { speak: false, reason: "tts-disabled" };
  const textLen = Array.from(opts.text).length;
  if (cfg.groupOnly && !isGroupChannel(opts.channelId)) return { speak: false, reason: "not-group" };
  if (cfg.onMentionOnly && !opts.mentioned) return { speak: false, reason: "not-mentioned" };
  if (textLen < cfg.minLength) return { speak: false, reason: "too-short" };
  if (textLen > cfg.maxLength) return { speak: false, reason: "too-long" };
  if (opts.now - opts.lastSpeakAt < cfg.cooldownSeconds * 1e3) return { speak: false, reason: "cooldown" };
  const roll = Math.random();
  if (roll >= cfg.probability) return { speak: false, reason: "probability-miss" };
  return { speak: true, reason: "hit" };
}

// src/sender.ts
var import_koishi = require("koishi");
async function sendVoice(bot, channelId, wavPath, platform) {
  const element = platform === "lark" ? (0, import_koishi.h)("audio", { src: wavPath }) : (0, import_koishi.h)("record", { src: wavPath });
  await bot.sendMessage(channelId, [element]);
}

// src/index.ts
var name = "aka-yesimbot-voice";
var inject = ["yesimbot"];
var Config = import_koishi2.Schema.object({
  ttsEnabled: import_koishi2.Schema.boolean().default(true).description("\u603B\u5F00\u5173\uFF1A\u5F00\u542F\u540E bot \u56DE\u590D\u6309\u7B56\u7565\u9644\u5E26\u8BED\u97F3"),
  platforms: import_koishi2.Schema.array(String).default(["onebot"]).description("\u751F\u6548\u5E73\u53F0\uFF1Aonebot\uFF08QQ\uFF09/ lark\uFF08\u98DE\u4E66\uFF09"),
  ttsApiBase: import_koishi2.Schema.string().default("http://127.0.0.1:50000").description("CosyVoice3 \u670D\u52A1\u5730\u5740"),
  voicePromptPath: import_koishi2.Schema.string().default("").description("\u97F3\u8272 prompt_wav \u672C\u5730\u8DEF\u5F84\uFF1B\u7559\u7A7A\u4F7F\u7528\u670D\u52A1\u7AEF\u9ED8\u8BA4\u97F3\u8272"),
  instructText: import_koishi2.Schema.string().default("\u8BF7\u7528\u81EA\u7136\u6D41\u7545\u7684\u4E2D\u82F1\u53CC\u8BED\u6717\u8BFB\uFF0C\u82F1\u6587\u5355\u8BCD\u4F7F\u7528\u6807\u51C6\u82F1\u8BED\u53D1\u97F3\uFF0C\u6CE8\u610F\u65AD\u53E5\u548C\u505C\u987F\uFF0C\u8BED\u901F\u9002\u4E2D\u3002<|endofprompt|>").description("\u6717\u8BFB\u6307\u4EE4"),
  ttsTimeoutMs: import_koishi2.Schema.number().min(1e3).max(12e4).default(3e4).description("\u5408\u6210\u8D85\u65F6 ms"),
  outputDir: import_koishi2.Schema.string().default("data/aka-yesimbot-voice").description("\u5408\u6210\u97F3\u9891\u8F93\u51FA\u76EE\u5F55"),
  probability: import_koishi2.Schema.number().min(0).max(1).default(0.2).description("\u6BCF\u6761\u56DE\u590D\u914D\u8BED\u97F3\u6982\u7387"),
  minLength: import_koishi2.Schema.number().min(0).default(8).description("\u6700\u77ED\u6587\u672C\u957F\u5EA6\uFF08\u5B57\u7B26\uFF09\u624D\u914D\u8BED\u97F3"),
  maxLength: import_koishi2.Schema.number().min(0).default(120).description("\u8D85\u8FC7\u6B64\u957F\u5EA6\u4E0D\u914D\u8BED\u97F3"),
  cooldownSeconds: import_koishi2.Schema.number().min(0).default(120).description("\u540C\u6E20\u9053\u51B7\u5374\u79D2\u6570"),
  groupOnly: import_koishi2.Schema.boolean().default(true).description("\u4EC5\u7FA4\u804A\u914D\u8BED\u97F3"),
  onMentionOnly: import_koishi2.Schema.boolean().default(false).description("\u4EC5\u88AB @ \u65F6\u914D\u8BED\u97F3"),
  logFailures: import_koishi2.Schema.boolean().default(true).description("\u5408\u6210/\u53D1\u9001\u5931\u8D25\u5199\u544A\u8B66\u65E5\u5FD7\uFF08\u4E0D\u5F71\u54CD\u6587\u672C\u56DE\u590D\uFF09")
});
function apply(ctx, config) {
  const logger = ctx.logger("aka-yesimbot-voice");
  const tts = new TtsClient({
    apiBase: config.ttsApiBase,
    timeoutMs: config.ttsTimeoutMs,
    voicePromptPath: config.voicePromptPath,
    instructText: config.instructText
  });
  const policyCfg = {
    ttsEnabled: config.ttsEnabled,
    probability: config.probability,
    minLength: config.minLength,
    maxLength: config.maxLength,
    cooldownSeconds: config.cooldownSeconds,
    groupOnly: config.groupOnly,
    onMentionOnly: config.onMentionOnly
  };
  const lastSpeakAt = /* @__PURE__ */ new Map();
  let currentChannelCtx = null;
  const voicePlugin = {
    name: "aka-yesimbot-voice",
    async onTurnFinish(result) {
      const ctxRef = currentChannelCtx;
      if (!ctxRef) return;
      const { bot, channelId, platform } = ctxRef;
      if (!config.platforms.includes(platform)) return;
      const text = extractReplyText(result.messages);
      if (!text) return;
      const now = Date.now();
      const decision = decide(policyCfg, {
        text,
        channelId,
        mentioned: false,
        // onTurnFinish 无 mention 信息；如需 @ 判定改由输入事件侧记录
        now,
        lastSpeakAt: lastSpeakAt.get(channelId) ?? 0
      });
      if (!decision.speak) {
        logger.debug("skip voice channel=%s reason=%s text=%s", channelId, decision.reason, text.slice(0, 30));
        return;
      }
      void (async () => {
        try {
          const out = await tts.synthesize(text, config.outputDir, `voice-${Date.now()}.wav`);
          await sendVoice(bot, channelId, out.wavPath, platform);
          lastSpeakAt.set(channelId, Date.now());
          logger.info("voice sent channel=%s len=%d dur=%dms wav=%s", channelId, out.pcmBytes, out.durationMs, out.wavPath);
        } catch (err) {
          if (config.logFailures) {
            logger.warn("voice failed channel=%s: %s", channelId, err instanceof Error ? err.message : String(err));
          }
        }
      })();
    }
  };
  const yesimbot = ctx.yesimbot;
  if (!yesimbot?.registerChannelPlugin) {
    logger.warn("yesimbot service unavailable \u2014 plugin inactive");
    return;
  }
  yesimbot.registerChannelPlugin(({ bot, scope }) => {
    currentChannelCtx = { bot, channelId: scope.channelId, platform: scope.platform };
    return voicePlugin;
  });
  logger.info("aka-yesimbot-voice registered (platforms=%s)", config.platforms.join(","));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
//# sourceMappingURL=index.js.map