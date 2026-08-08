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
  if (typeof content === "string") return stripMessageTags(content.trim());
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (part && typeof part === "object" && part.type === "text") {
      const text = part.text;
      if (typeof text === "string" && text.trim()) parts.push(stripMessageTags(text.trim()));
    }
  }
  return parts.join("\n").trim();
}
function stripMessageTags(text) {
  return text.replace(/<\/?message>/g, "").replace(/<[^>]+>/g, (tag) => tag.startsWith("</") || tag.startsWith("<message") ? "" : tag).trim();
}

// src/policy.ts
function isGroupChannel(channelId, isShared) {
  if (isShared !== void 0) return isShared;
  return channelId.startsWith("group:");
}
function decide(cfg, opts) {
  if (!cfg.ttsEnabled) return { speak: false, reason: "tts-disabled" };
  const textLen = Array.from(opts.text).length;
  if (cfg.groupOnly && !isGroupChannel(opts.channelId, opts.isShared)) return { speak: false, reason: "not-group" };
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
var import_fs = require("fs");
async function sendVoice(bot, channelId, wavPath, platform, napcatHttpUrl) {
  if (platform === "onebot" && napcatHttpUrl) {
    await sendViaNapcat(napcatHttpUrl, channelId, wavPath);
    return;
  }
  const src = `file://${wavPath}`;
  const element = platform === "lark" ? (0, import_koishi.h)("audio", { src }) : (0, import_koishi.h)("record", { src });
  await bot.sendMessage(channelId, [element]);
}
async function sendViaNapcat(baseUrl, channelId, wavPath) {
  const b64 = (0, import_fs.readFileSync)(wavPath).toString("base64");
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/send_group_msg`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group_id: Number(channelId),
      message: [{ type: "record", data: { file: `base64://${b64}` } }]
    })
  });
  if (!res.ok) {
    throw new Error(`NapCat HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data.status !== "ok" || data.retcode !== 0) {
    throw new Error(`NapCat send_group_msg failed: ${data.message ?? "unknown"}`);
  }
}

// src/preprocess.ts
async function render(input, opts) {
  const rules = ruleLayer(input);
  if (!opts.llm) {
    const text2 = opts.injectBreath ? injectBreath(rules) : rules;
    return { text: text2, ratio: 1, source: "rules", degraded: false };
  }
  let raw = null;
  let failReason;
  try {
    raw = await opts.llm.rewrite(rules, opts.prompt, opts.timeoutMs);
  } catch (err) {
    failReason = err instanceof Error ? err.message : String(err);
    raw = null;
  }
  if (opts.logPrompts && opts.logger) {
    opts.logger.info(
      "llm prompt in=%s out=%s",
      rules.slice(0, 80),
      (raw ?? "<null>").slice(0, 80)
    );
  }
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    if (failReason && opts.logger) opts.logger.warn("llm rewrite failed: %s", failReason);
    const text2 = opts.injectBreath ? injectBreath(rules) : rules;
    return { text: text2, ratio: 1, source: "rules", degraded: true, reason: failReason ?? "empty" };
  }
  const ratio = fidelityRatio(rules, trimmed);
  if (ratio < opts.fidelityRatio) {
    const text2 = opts.injectBreath ? injectBreath(rules) : rules;
    return { text: text2, ratio, source: "rules", degraded: true, reason: "fidelity" };
  }
  const text = opts.injectBreath ? injectBreath(trimmed) : trimmed;
  return { text, ratio, source: "llm", degraded: false };
}
function ruleLayer(text) {
  if (!text) return "";
  let s = text.replace(/\r\n?/g, "\n").trim();
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/([。！？!?])\1+/g, "$1");
  s = s.replace(/([，,、;；])\1+/g, "$1");
  s = s.replace(/([一-龥])([A-Za-z0-9])/g, "$1 $2");
  s = s.replace(/([A-Za-z0-9])([一-龥])/g, "$1 $2");
  if (s) {
    const tail = s.slice(-1);
    if (!/[。！？!?…\.]/.test(tail)) {
      if (/[一-龥]/.test(tail)) s += "\u3002";
      else if (/[A-Za-z0-9]/.test(tail)) s += ".";
    }
  }
  return s;
}
function fidelityRatio(a, b) {
  const [aa, bb] = pickCharSeq(a, b);
  if (!aa.length && !bb.length) return 1;
  if (!aa.length || !bb.length) return 0;
  const lcs = lcsLength(aa, bb);
  return 2 * lcs / (aa.length + bb.length);
}
function pickCharSeq(a, b) {
  const ac = a.match(/[一-龥]/g)?.join("") ?? "";
  const bc = b.match(/[一-龥]/g)?.join("") ?? "";
  if (ac || bc) return [ac, bc];
  const strip = (s) => s.replace(/\[[a-zA-Z_]+\]/g, "").replace(/\s+/g, "").toLowerCase();
  return [strip(a), strip(b)];
}
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const pj = prev[j] ?? 0;
      const cj1 = curr[j - 1] ?? 0;
      if (a[i - 1] === b[j - 1]) curr[j] = (prev[j - 1] ?? 0) + 1;
      else curr[j] = pj >= cj1 ? pj : cj1;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[n] ?? 0;
}
var BREATH_MARK_RE = /\[(breath|quick_breath|sigh|laughter|cough|noise)\]\s*$/;
function injectBreath(text) {
  if (!text) return "";
  const parts = [];
  const re = /[^。！？!?]+[。！？!?]?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) parts.push(m[0]);
  }
  if (parts.length < 3) return text;
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i] ?? "";
    out.push(seg);
    if (i === parts.length - 1) continue;
    if (BREATH_MARK_RE.test(seg)) continue;
    out.push("[breath]");
  }
  return out.join("");
}

// src/llm-channel.ts
function renderPrompt(template, text) {
  return template.includes("{text}") ? template.replace("{text}", text) : `${template}

${text}`;
}
function fromYesimbot(ctx, opts = {}) {
  const modelService = ctx?.yesimbot?.model;
  if (!modelService) return null;
  return {
    source: "yesimbot",
    async rewrite(text, promptTemplate, timeoutMs) {
      const wanted = opts.modelId?.trim() || modelService.getDefaultChatModelId?.();
      if (!wanted) throw new Error("yesimbot: no default chat model");
      const ref = modelService.resolveChatModel(wanted);
      if (!ref?.model) throw new Error(`yesimbot: cannot resolve model ${wanted}`);
      const mod = await import("ai").catch(() => null);
      if (!mod?.generateText) throw new Error("'ai' package unavailable");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      try {
        const result = await mod.generateText({
          model: ref.model,
          prompt: renderPrompt(promptTemplate, text),
          abortSignal: controller.signal
        });
        return String(result?.text ?? "").trim();
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
function fromCustom(cfg, fetchLike = globalThis.fetch.bind(globalThis)) {
  return {
    source: "custom",
    async rewrite(text, promptTemplate, timeoutMs) {
      if (!cfg.apiBase) throw new Error("custom: apiBase empty");
      if (!cfg.model) throw new Error("custom: model empty");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      try {
        const resp = await fetchLike(`${cfg.apiBase.replace(/\/+$/, "")}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: renderPrompt(promptTemplate, text) }],
            temperature: 0.7
          }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const detail = await resp.text().catch(() => "");
          throw new Error(`custom LLM HTTP ${resp.status}: ${detail.slice(0, 120)}`);
        }
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content ?? "";
        return String(raw).trim();
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

// src/index.ts
var DEFAULT_LLM_PROMPT = `\u4F60\u662F\u4E13\u4E1A\u7684\u58F0\u97F3\u5BFC\u6F14\u3002\u628A\u4E0B\u9762\u7684\u5BF9\u8BDD\u56DE\u590D\u6539\u5199\u6210"\u6717\u8BFB\u53CB\u597D\u6587\u672C"\uFF0C\u4EA4\u7ED9 CosyVoice \u5408\u6210\u8BED\u97F3\u3002
\u8981\u6C42\uFF1A
1. \u4FDD\u7559\u539F\u610F\u4E0E\u4FE1\u606F\uFF0C\u4E0D\u5F97\u589E\u5220\u4E8B\u5B9E\u3001\u4E0D\u5F97\u6539\u4EBA\u79F0/\u6570\u5B57/\u4E13\u6709\u540D\u8BCD
2. \u52A0\u5165\u81EA\u7136\u7684\u53E3\u8BED\u8282\u594F\uFF1A\u9002\u5F53\u65AD\u53E5\u3001\u505C\u987F\u63D0\u793A\u3001\u8BED\u6C14\u8BCD\uFF08\u55EF\u3001\u554A\u3001\u54C8\uFF09\uFF0C\u589E\u5F3A\u60C5\u7EEA\u8868\u8FBE
3. \u6587\u672C\u4E2D\u53EF\u7528\u4EE5\u4E0B\u6807\u8BB0\u63A7\u5236\u97F5\u5F8B\uFF1A[breath] \u6362\u6C14 [laughter] \u7B11\u58F0 [sigh] \u53F9\u6C14\uFF08\u9002\u91CF\u4F7F\u7528\uFF0C\u6BCF\u53E5\u6700\u591A 1 \u4E2A\uFF09
4. \u6807\u70B9\u89C4\u8303\u5316\uFF1A\u53E5\u672B\u5FC5\u987B\u6709\u53E5\u53F7/\u95EE\u53F7/\u611F\u53F9\u53F7\uFF1B\u9017\u53F7\u8868\u793A\u77ED\u505C\u987F\uFF0C\u53E5\u53F7\u8868\u793A\u957F\u505C\u987F
5. \u82F1\u6587\u5355\u8BCD\u4FDD\u6301\u539F\u6837\uFF0C\u524D\u540E\u52A0\u7A7A\u683C\uFF1B\u6570\u5B57\u6309\u81EA\u7136\u8BFB\u6CD5\u6539\u5199\uFF08\u5982 3.5 \u2192 \u4E09\u70B9\u4E94\uFF09
6. \u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u6587\u672C\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u5F15\u53F7\u3001\u4E0D\u8981 markdown
7. \u8F93\u51FA\u957F\u5EA6\u4E0E\u539F\u6587\u672C\u76F8\u5F53\uFF08\xB130%\uFF09\uFF0C\u4E0D\u5F97\u6269\u5199

\u539F\u6587\uFF1A
{text}`;
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
  logFailures: import_koishi2.Schema.boolean().default(true).description("\u5408\u6210/\u53D1\u9001\u5931\u8D25\u5199\u544A\u8B66\u65E5\u5FD7\uFF08\u4E0D\u5F71\u54CD\u6587\u672C\u56DE\u590D\uFF09"),
  napcatHttpUrl: import_koishi2.Schema.string().default("").description("NapCat HTTP API \u5730\u5740\uFF0C\u5982 http://mita_napcat:6199\uFF1BQQ \u8BED\u97F3\u76F4\u53D1\u8D70\u6B64\u901A\u9053\uFF0C\u7559\u7A7A\u56DE\u9000 Koishi \u5143\u7D20\u53D1\u9001\uFF08\u672C\u5730\u5F00\u53D1\uFF09"),
  replaceText: import_koishi2.Schema.boolean().default(false).description("\u547D\u4E2D\u8BED\u97F3\u65F6\u541E\u6389 yesimbot \u6587\u672C\u56DE\u590D\uFF0C\u53EA\u53D1\u8BED\u97F3\uFF08TTS \u5931\u8D25\u81EA\u52A8\u8865\u53D1\u6587\u672C\uFF09"),
  llm: import_koishi2.Schema.object({
    enabled: import_koishi2.Schema.boolean().default(true).description("LLM \u8BED\u97F3\u6548\u679C\u6E32\u67D3\uFF08\u9ED8\u8BA4\u5F00\uFF0C\u8D70 yesimbot \u4E3B\u6A21\u578B\u901A\u9053\uFF09"),
    source: import_koishi2.Schema.union(["yesimbot", "custom"]).default("yesimbot").description("LLM \u901A\u9053\uFF1Ayesimbot \u4E3B\u6A21\u578B / \u72EC\u7ACB\u914D\u7F6E"),
    model: import_koishi2.Schema.string().default("").description("yesimbot \u6A21\u578B fullId\uFF08\u5982 deepseek:deepseek-v4-flash\uFF09\uFF1B\u7A7A = yesimbot \u9ED8\u8BA4\u4E3B\u6A21\u578B"),
    apiBase: import_koishi2.Schema.string().default("").description("\u72EC\u7ACB\u901A\u9053 baseURL\uFF08source=custom \u751F\u6548\uFF09"),
    apiKey: import_koishi2.Schema.string().role("secret").default("").description("\u72EC\u7ACB\u901A\u9053 API Key\uFF08source=custom \u751F\u6548\uFF1B\u4E0D\u5199\u65E5\u5FD7\uFF09"),
    customModel: import_koishi2.Schema.string().default("").description("\u72EC\u7ACB\u901A\u9053\u6A21\u578B\u540D\uFF08source=custom \u751F\u6548\uFF09"),
    timeoutMs: import_koishi2.Schema.number().min(1e3).max(12e4).default(6e4).description("LLM \u8C03\u7528\u8D85\u65F6 ms\uFF0C\u8D85\u65F6\u964D\u7EA7\u539F\u6587"),
    prompt: import_koishi2.Schema.string().role("textarea").default(DEFAULT_LLM_PROMPT).description("\u6539\u5199\u6307\u4EE4\u6A21\u677F\uFF08{text} \u5360\u4F4D\uFF09"),
    fidelityRatio: import_koishi2.Schema.number().min(0).max(1).step(0.01).default(0.95).description("\u5185\u5BB9\u4FDD\u771F\u9608\u503C 0-1\uFF0C\u4F4E\u4E8E\u5219\u56DE\u9000\u89C4\u5219\u5C42\u7ED3\u679C"),
    injectBreath: import_koishi2.Schema.boolean().default(true).description("LLM \u4E4B\u540E\u6309\u89C4\u5219\u6CE8\u5165 [breath] \u6362\u6C14"),
    logPrompts: import_koishi2.Schema.boolean().default(false).description("\u8C03\u8BD5\uFF1A\u65E5\u5FD7\u8F93\u51FA\u6539\u5199\u524D\u540E\u6587\u672C\uFF08\u4E0D\u542B key\uFF09")
  }).description("LLM \u8BED\u97F3\u6548\u679C\u6E32\u67D3")
});
function apply(ctx, config) {
  const logger = ctx.logger("aka-yesimbot-voice");
  const tts = new TtsClient({
    apiBase: config.ttsApiBase,
    timeoutMs: config.ttsTimeoutMs,
    voicePromptPath: config.voicePromptPath,
    instructText: config.instructText
  });
  const llmCfg = config.llm;
  let llmChannel = null;
  if (llmCfg.enabled) {
    if (llmCfg.source === "yesimbot") {
      llmChannel = fromYesimbot(ctx, { modelId: llmCfg.model, logger });
      if (!llmChannel) logger.warn("llm channel yesimbot unavailable \u2014 falling back to rules");
    } else if (llmCfg.source === "custom") {
      if (llmCfg.apiBase && llmCfg.customModel) {
        llmChannel = fromCustom({ apiBase: llmCfg.apiBase, apiKey: llmCfg.apiKey, model: llmCfg.customModel });
      } else {
        logger.warn("llm channel custom missing apiBase/customModel \u2014 falling back to rules");
      }
    }
  }
  const renderOpts = {
    llm: llmChannel,
    fidelityRatio: llmCfg.fidelityRatio,
    injectBreath: llmCfg.injectBreath,
    timeoutMs: llmCfg.timeoutMs,
    prompt: llmCfg.prompt || DEFAULT_LLM_PROMPT,
    logPrompts: llmCfg.logPrompts,
    logger
  };
  async function renderVoice(text) {
    return render(text, renderOpts);
  }
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
  const pendingVoice = /* @__PURE__ */ new Map();
  const turnSegments = /* @__PURE__ */ new Map();
  function consumePending(channelId, bot, platform) {
    const item = pendingVoice.get(channelId);
    if (!item || item.consumed) return;
    item.consumed = true;
    if (item.timer) clearTimeout(item.timer);
    pendingVoice.delete(channelId);
    const text = item.text;
    void (async () => {
      try {
        const rendered = await renderVoice(text);
        const out = await tts.synthesize(rendered.text, config.outputDir, `voice-${Date.now()}.wav`);
        await sendVoice(bot, channelId, out.wavPath, platform, config.napcatHttpUrl);
        lastSpeakAt.set(channelId, Date.now());
        logger.info(
          "voice sent (text replaced) channel=%s len=%d dur=%dms source=%s ratio=%s degraded=%s%s rendered=%s",
          channelId,
          out.pcmBytes,
          out.durationMs,
          rendered.source,
          rendered.ratio.toFixed(3),
          rendered.degraded,
          rendered.reason ? ` reason=${rendered.reason}` : "",
          rendered.text.slice(0, 40)
        );
      } catch (err) {
        logger.warn("voice failed, fallback text channel=%s: %s", channelId, err instanceof Error ? err.message : String(err));
        try {
          await bot.sendMessage(channelId, text);
          logger.info("fallback text sent channel=%s", channelId);
        } catch (fallbackErr) {
          if (config.logFailures) {
            logger.warn("fallback text also failed channel=%s: %s", channelId, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
          }
        }
      }
    })();
  }
  function queuePending(bot, channelId, platform, text) {
    const existing = pendingVoice.get(channelId);
    if (existing && !existing.consumed) {
      existing.text = existing.text.length > text.length ? existing.text : text;
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = setTimeout(() => consumePending(channelId, bot, platform), 600);
      return;
    }
    const timer = setTimeout(() => consumePending(channelId, bot, platform), 600);
    pendingVoice.set(channelId, { text, timer, consumed: false });
  }
  function extractSendText(content) {
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content.map((seg) => {
        if (typeof seg === "string") return seg;
        if (seg && typeof seg === "object") {
          const s = seg;
          if (s.attrs?.content) return s.attrs.content;
          if (s.attrs?.text) return s.attrs.text;
          if (Array.isArray(s.children)) return s.children.map((c) => typeof c === "string" ? c : "").join("");
        }
        return "";
      }).join("").trim();
    }
    return "";
  }
  function extractTurnSegments(content) {
    const text = (() => {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.filter((p) => p && typeof p === "object" && p.type === "text").map((p) => p.text ?? "").join("\n");
      }
      return "";
    })();
    if (!text) return [];
    return text.split(/<message\s*\/?\s*>/).map((s) => s.replace(/<\/message>/g, "").trim()).filter(Boolean);
  }
  const yesimbot = ctx.yesimbot;
  if (!yesimbot?.registerChannelPlugin) {
    logger.warn("yesimbot service unavailable \u2014 plugin inactive");
    return;
  }
  yesimbot.registerChannelPlugin(({ bot, scope }) => {
    const channelId = scope.channelId;
    const platform = scope.platform;
    const isShared = scope.type === "shared";
    if (config.replaceText && config.platforms.includes(platform) && !bot._akaVoicePatched) {
      ;
      bot._akaVoicePatched = true;
      const origSend = bot.sendMessage.bind(bot);
      bot.sendMessage = (async (cid, content, ...rest) => {
        const text = extractSendText(content);
        const cidStr = String(cid);
        if (text && isShared && !pendingVoice.has(cidStr)) {
          const segments = turnSegments.get(cidStr) ?? [];
          const isTurnReply = segments.includes(text);
          if (isTurnReply) {
            const decision = decide(policyCfg, {
              text,
              channelId: cidStr,
              isShared,
              mentioned: false,
              now: Date.now(),
              lastSpeakAt: lastSpeakAt.get(cidStr) ?? 0
            });
            if (decision.speak) {
              logger.info("text replaced by voice channel=%s text=%s", cidStr, text.slice(0, 30));
              queuePending(bot, cidStr, platform, text);
              return [];
            }
            logger.info("text kept (voice skip) channel=%s reason=%s text=%s", cidStr, decision.reason, text.slice(0, 30));
          }
        } else if (text && pendingVoice.has(cidStr)) {
          queuePending(bot, cidStr, platform, text);
          return [];
        }
        return origSend(cid, content, ...rest);
      });
      logger.info("aka-yesimbot-voice: sendMessage patched (replaceText)");
    }
    const plugin = {
      name: "aka-yesimbot-voice",
      // 记录本 turn 的 <message> 段，供 sendMessage patch 匹配（只吞 yesimbot 回复）
      async onAppend(entries) {
        if (!config.replaceText) return;
        for (const entry of entries) {
          if (entry?.type !== "message") continue;
          const data = entry.data;
          if (data?.role !== "assistant") continue;
          const segments = extractTurnSegments(data.content);
          if (segments.length > 0) {
            turnSegments.set(channelId, segments);
          }
        }
      },
      // replaceText 模式：turn 结束立即消费；旧模式：文本照发语音附带
      async onTurnFinish(result) {
        if (config.replaceText) {
          turnSegments.delete(channelId);
          const item = pendingVoice.get(channelId);
          if (item && !item.consumed) {
            consumePending(channelId, bot, platform);
          }
          return;
        }
        if (!config.platforms.includes(platform)) return;
        const text = extractReplyText(result.messages);
        if (!text) return;
        logger.info("voice candidate channel=%s shared=%s text=%s", channelId, isShared, text.slice(0, 40));
        const now = Date.now();
        const decision = decide(policyCfg, {
          text,
          channelId,
          isShared,
          mentioned: false,
          now,
          lastSpeakAt: lastSpeakAt.get(channelId) ?? 0
        });
        if (!decision.speak) {
          logger.info("skip voice channel=%s reason=%s text=%s", channelId, decision.reason, text.slice(0, 30));
          return;
        }
        void (async () => {
          try {
            const rendered = await renderVoice(text);
            const out = await tts.synthesize(rendered.text, config.outputDir, `voice-${Date.now()}.wav`);
            await sendVoice(bot, channelId, out.wavPath, platform, config.napcatHttpUrl);
            lastSpeakAt.set(channelId, Date.now());
            logger.info(
              "voice sent channel=%s len=%d dur=%dms source=%s ratio=%s degraded=%s%s wav=%s",
              channelId,
              out.pcmBytes,
              out.durationMs,
              rendered.source,
              rendered.ratio.toFixed(3),
              rendered.degraded,
              rendered.reason ? ` reason=${rendered.reason}` : "",
              out.wavPath
            );
          } catch (err) {
            if (config.logFailures) {
              logger.warn("voice failed channel=%s: %s", channelId, err instanceof Error ? err.message : String(err));
            }
          }
        })();
      }
    };
    return plugin;
  });
  logger.info(
    "aka-yesimbot-voice registered (platforms=%s, replaceText=%s, llm=%s%s)",
    config.platforms.join(","),
    config.replaceText,
    llmCfg.enabled ? llmChannel ? llmChannel.source : "rules-fallback" : "off",
    llmCfg.enabled && llmChannel ? `, breath=${llmCfg.injectBreath}` : ""
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
//# sourceMappingURL=index.js.map