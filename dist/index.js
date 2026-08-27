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
var import_node_path2 = require("path");

// src/tts-client.ts
var WAV_HEADER_SIZE = 44;
var TtsClient = class {
  constructor(config, fetchLike = globalThis.fetch.bind(globalThis)) {
    this.config = config;
    this.fetchLike = fetchLike;
  }
  async synthesize(text, outDir, outName = "voice.wav", voice) {
    const startedAt = Date.now();
    const { apiBase, timeoutMs } = this.config;
    const boundary = `----akaTts${Date.now()}${Math.random().toString(16).slice(2)}`;
    const chunks = [];
    const rawTranscript = (voice?.transcript ?? "").trim();
    const promptText = rawTranscript ? `You are a helpful assistant.<|endofprompt|>${rawTranscript}` : "";
    const pushField = (name2, value) => {
      chunks.push(Buffer.from(`--${boundary}\r
Content-Disposition: form-data; name="${name2}"\r
\r
${value}\r
`));
    };
    pushField("tts_text", text);
    pushField("prompt_text", promptText);
    pushField("speed", String(this.config.speed ?? 1.2));
    if (voice?.path) {
      const fs2 = await import("fs");
      const audio = await fs2.promises.readFile(voice.path);
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
      response = await this.fetchLike(`${apiBase}/inference_zero_shot`, {
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
    let pcm = Buffer.from(await response.arrayBuffer());
    if (pcm.length < WAV_HEADER_SIZE) throw new Error(`TTS empty audio (${pcm.length} bytes)`);
    let loudnormApplied = false;
    if (this.config.loudnorm) {
      const ln = await this.applyLoudnorm(pcm);
      pcm = ln.pcm;
      loudnormApplied = ln.applied;
    }
    const { mkdir } = await import("fs/promises");
    const { join: join3 } = await import("path");
    await mkdir(outDir, { recursive: true });
    const wavPath = join3(outDir, outName);
    const fs = await import("fs");
    await fs.promises.writeFile(wavPath, wrapWav(pcm, this.config.tailPadMs));
    return { wavPath, durationMs: Date.now() - startedAt, pcmBytes: pcm.length, loudnormApplied };
  }
  /**
   * 调服务端 /loudnorm，把 24kHz mono s16 PCM 归一化到 -20 LUFS。
   * 失败（网络/非 2xx/返回过小）返回 { pcm: 原样, applied: false }，绝不抛错。
   */
  async applyLoudnorm(pcm) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await this.fetchLike(`${this.config.apiBase.replace(/\/+$/, "")}/loudnorm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(pcm.length)
        },
        body: new Uint8Array(pcm),
        signal: controller.signal
      });
      if (!res.ok) return { pcm, applied: false };
      const out = Buffer.from(await res.arrayBuffer());
      if (out.length < WAV_HEADER_SIZE) return { pcm, applied: false };
      return { pcm: out, applied: true };
    } catch {
      return { pcm, applied: false };
    } finally {
      clearTimeout(timer);
    }
  }
};
function wrapWav(pcm, tailPadMs = 0) {
  const sampleRate = 24e3;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const tailPadSamples = Math.max(0, Math.round(tailPadMs / 1e3 * sampleRate));
  const tailPadBytes = tailPadSamples * channels * bitsPerSample / 8;
  const dataSize = pcm.length + tailPadBytes;
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
  const tail = Buffer.alloc(tailPadBytes);
  return Buffer.concat([header, pcm, tail]);
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
    const text2 = stripProsodyMarkers(opts.injectBreath ? injectBreath(rules) : rules);
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
    const text2 = stripProsodyMarkers(opts.injectBreath ? injectBreath(rules) : rules);
    return { text: text2, ratio: 1, source: "rules", degraded: true, reason: failReason ?? "empty" };
  }
  const ratio = fidelityRatio(rules, trimmed);
  if (ratio < opts.fidelityRatio) {
    const text2 = stripProsodyMarkers(opts.injectBreath ? injectBreath(rules) : rules);
    return { text: text2, ratio, source: "rules", degraded: true, reason: "fidelity" };
  }
  const text = stripProsodyMarkers(opts.injectBreath ? injectBreath(trimmed) : trimmed);
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
function stripProsodyMarkers(text) {
  if (!text) return "";
  let s = text.replace(/\[[^\[\]]*\]/g, "");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/ +([。！？!?，,、；;])/g, "$1");
  s = s.replace(/([。！？!?，,、；;]) +/g, "$1");
  return s.trim();
}
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

// src/voices.ts
var import_node_fs = require("fs");
var import_node_path = require("path");
function readJson(dir, fileName) {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(dir, fileName), "utf8"));
  } catch {
    return void 0;
  }
}
function readText(dir, fileName) {
  try {
    const content = (0, import_node_fs.readFileSync)((0, import_node_path.join)(dir, fileName), "utf8").trim();
    return content || void 0;
  } catch {
    return void 0;
  }
}
function readVoiceTranscript(dir, baseName) {
  const candidates = [`${baseName}.txt`, "ref_transcript.txt"];
  for (const c of candidates) {
    const content = readText(dir, c);
    if (content) return content;
  }
  return void 0;
}
function deriveStylePrompt(vt) {
  if (!vt) return void 0;
  const parts = [];
  if (vt.persona) parts.push(`\u4EBA\u8BBE\uFF1A${vt.persona}`);
  if (vt.speech_style?.rhythm) parts.push(`\u8282\u594F\uFF1A${vt.speech_style.rhythm}`);
  if (vt.speech_style?.punctuation) parts.push(`\u6807\u70B9\uFF1A${vt.speech_style.punctuation}`);
  if (vt.style_notes) parts.push(vt.style_notes);
  if (vt.writing_guide) parts.push(vt.writing_guide);
  return parts.length ? parts.join("\n") : void 0;
}
var VoiceLibrary = class {
  constructor(dir) {
    this.dir = dir;
  }
  /** 扫描并返回全部可用音色（已按名字排序）；目录不存在/不可读返回空数组 */
  scan() {
    let entries;
    try {
      entries = (0, import_node_fs.readdirSync)(this.dir);
    } catch {
      return [];
    }
    const voices = [];
    for (const entry of entries) {
      const full = (0, import_node_path.join)(this.dir, entry);
      let stats;
      try {
        stats = (0, import_node_fs.statSync)(full);
      } catch {
        continue;
      }
      let info;
      if (stats.isDirectory()) {
        if (!existsRefWav(full)) continue;
        const promptTemplate = readJson(full, "prompt_template.json");
        info = {
          name: entry,
          path: (0, import_node_path.join)(full, "ref.wav"),
          transcript: readVoiceTranscript(full, "ref"),
          meta: readJson(full, "meta.json"),
          promptTemplate,
          stylePrompt: deriveStylePrompt(promptTemplate)
        };
      } else if (entry.toLowerCase().endsWith(".wav")) {
        if (stats.size < 1024) continue;
        const baseName = entry.slice(0, -4);
        const promptTemplate = readJson(this.dir, `${baseName}.prompt_template.json`);
        info = {
          name: baseName,
          path: full,
          transcript: readVoiceTranscript(this.dir, baseName),
          meta: readJson(this.dir, `${baseName}.meta.json`),
          promptTemplate,
          stylePrompt: deriveStylePrompt(promptTemplate)
        };
      }
      if (info) voices.push(info);
    }
    voices.sort((a, b) => a.name.localeCompare(b.name));
    return voices;
  }
  /**
   * 按配置解析当前音色：
   * - 'auto' → 扫描结果第一个（无则 null）
   * - 具名 → 匹配该音色；不存在 → 回退第一个
   * 始终基于最新扫描结果；目录无音色返回 null。
   */
  resolve(voice) {
    const voices = this.scan();
    if (!voices.length) return null;
    if (voice && voice !== "auto") {
      const found = voices.find((v) => v.name === voice);
      if (found) return found;
    }
    return voices[0] ?? null;
  }
};
function existsRefWav(dir) {
  try {
    return (0, import_node_fs.statSync)((0, import_node_path.join)(dir, "ref.wav")).isFile();
  } catch {
    return false;
  }
}

// src/index.ts
var DEFAULT_LLM_PROMPT = `\u4F60\u662F\u4E13\u4E1A\u7684\u58F0\u97F3\u5BFC\u6F14\u3002\u628A\u4E0B\u9762\u7684\u5BF9\u8BDD\u56DE\u590D\u6539\u5199\u6210"\u6717\u8BFB\u53CB\u597D\u6587\u672C"\uFF0C\u4EA4\u7ED9 CosyVoice \u5408\u6210\u8BED\u97F3\u3002
\u8981\u6C42\uFF1A
1. \u4FDD\u7559\u539F\u610F\u4E0E\u4FE1\u606F\uFF0C\u4E0D\u5F97\u589E\u5220\u4E8B\u5B9E\u3001\u4E0D\u5F97\u6539\u4EBA\u79F0/\u6570\u5B57/\u4E13\u6709\u540D\u8BCD
2. \u6309\u8BED\u4E49\u610F\u7FA4\u62C6\u53E5\uFF1A\u628A\u957F\u53E5\u5728\u8C13\u8BCD/\u5E76\u5217/\u8FDE\u8BCD\u5904\u62C6\u6210\u51E0\u4E2A\u77ED\u53E5\uFF08\u6BCF\u53E5\u4E00\u4E2A\u5B8C\u6574\u4FE1\u606F\u5757\uFF09\uFF0C\u5E76\u4FDD\u8BC1\u6BCF\u53E5\u7ED3\u5C3E\u6709\u7EC8\u6B62\u6807\u70B9\uFF08\u53E5\u53F7/\u95EE\u53F7/\u611F\u53F9\u53F7\uFF09\uFF1B\u4E0D\u8981\u628A\u4E00\u4E2A\u4FE1\u606F\u5757\u786C\u5207\u6210\u788E\u7247
3. \u52A0\u5165\u81EA\u7136\u7684\u53E3\u8BED\u8282\u594F\uFF1A\u9002\u5F53\u65AD\u53E5\u3001\u505C\u987F\u63D0\u793A\u3001\u8BED\u6C14\u8BCD\uFF08\u55EF\u3001\u554A\u3001\u54C8\uFF09\uFF0C\u589E\u5F3A\u60C5\u7EEA\u8868\u8FBE
4. \u4E0D\u8981\u63D2\u5165\u4EFB\u4F55\u65B9\u62EC\u53F7\u6807\u8BB0\uFF08\u5982 [breath] \u7B49\u4F1A\u88AB\u4E22\u5F03\uFF09
5. \u6807\u70B9\u89C4\u8303\u5316\uFF1A\u53E5\u672B\u5FC5\u987B\u6709\u53E5\u53F7/\u95EE\u53F7/\u611F\u53F9\u53F7\uFF1B\u9017\u53F7\u8868\u793A\u77ED\u505C\u987F\uFF0C\u53E5\u53F7\u8868\u793A\u957F\u505C\u987F
6. \u82F1\u6587\u5355\u8BCD\u4FDD\u6301\u539F\u6837\uFF0C\u524D\u540E\u52A0\u7A7A\u683C\uFF1B\u6570\u5B57\u6309\u81EA\u7136\u8BFB\u6CD5\u6539\u5199\uFF08\u5982 3.5 \u2192 \u4E09\u70B9\u4E94\uFF09
7. \u53EA\u8F93\u51FA\u6539\u5199\u540E\u7684\u6587\u672C\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u5F15\u53F7\u3001\u4E0D\u8981 markdown
8. \u8F93\u51FA\u957F\u5EA6\u4E0E\u539F\u6587\u672C\u76F8\u5F53\uFF08\xB130%\uFF09\uFF0C\u4E0D\u5F97\u6269\u5199

\u539F\u6587\uFF1A
{text}`;
function composeVoicePrompt(stylePrompt) {
  if (!stylePrompt) return DEFAULT_LLM_PROMPT;
  return DEFAULT_LLM_PROMPT.replace(
    "\n\u539F\u6587\uFF1A\n{text}",
    `
\u6717\u8BFB\u98CE\u683C\uFF08\u8D34\u5408\u5F53\u524D\u97F3\u8272\uFF0C\u4F46\u4E25\u7981\u589E\u5220\u6216\u6539\u53D8\u539F\u610F\u7684\u5B57\u9762\u5185\u5BB9\uFF0C\u53EA\u5FAE\u8C03\u8BED\u6C14\u4E0E\u63AA\u8F9E\uFF09\uFF1A
${stylePrompt}

\u539F\u6587\uFF1A
{text}`
  );
}
var name = "aka-yesimbot-voice";
var inject = ["yesimbot"];
var Config = import_koishi2.Schema.object({
  hint: import_koishi2.Schema.object({}).description(
    "\u628A bot \u7684\u56DE\u590D\u8F6C\u6210\u8BED\u97F3\u53D1\u5230 QQ \u7FA4\u3002\n\n\u25A0 \u97F3\u8272\u6587\u4EF6\n\u97F3\u8272\u76EE\u5F55\uFF1Adata/aka-yesimbot-voice/voices\uFF08\u4E0B\u65B9 voiceDir\uFF09\n\u6BCF\u4E2A\u97F3\u8272 = <\u97F3\u8272\u540D>.wav\uFF08\u53C2\u8003\u97F3\u9891\uFF09+ \u540C\u540D <\u97F3\u8272\u540D>.txt\uFF08\u8BE5\u97F3\u9891\u7684\u771F\u5B9E\u8F6C\u5199\uFF09\n\u653E\u5165\u5373\u65B0\u589E\uFF0C\u91CD\u542F\u540E\u81EA\u52A8\u53EF\u7528\u3002\n\n\u25A0 \u5F53\u524D\u97F3\u8272\n\u552F\u4E00\u771F\u6E90 = data/aka-yesimbot-voice/settings.json\n\u7528 .voice \u547D\u4EE4\u5207\u6362\uFF1A.voice \u67E5\u770B\u5217\u8868\uFF0C.voice <\u97F3\u8272\u540D> \u5207\u6362\n\u672C\u914D\u7F6E\u9875\u4E0D\u8BBE\u7F6E\u97F3\u8272\u3002"
  ),
  probability: import_koishi2.Schema.number().min(0).max(1).default(1).description("\u6BCF\u6761\u56DE\u590D\u914D\u8BED\u97F3\u6982\u7387"),
  llm: import_koishi2.Schema.boolean().default(true).description("LLM \u8BED\u97F3\u6548\u679C\u6E32\u67D3\uFF08\u8D70 yesimbot \u4E3B\u6A21\u578B\uFF1B\u5931\u8D25\u81EA\u52A8\u964D\u7EA7\u89C4\u5219\u5C42\uFF09"),
  voiceDir: import_koishi2.Schema.string().default("data/aka-yesimbot-voice/voices").description("\u97F3\u8272\u6E90\u76EE\u5F55\uFF1A\u5F80\u91CC\u653E/\u5220 *.wav \u5373\u589E\u5220\u97F3\u8272\uFF08\u91CD\u542F\u751F\u6548\uFF09"),
  advanced: import_koishi2.Schema.object({
    ttsApiBase: import_koishi2.Schema.string().default("http://100.121.167.1:50000").description("CosyVoice3 \u670D\u52A1\u5730\u5740"),
    ttsTimeoutMs: import_koishi2.Schema.number().min(1e3).max(12e4).default(3e4).description("\u5408\u6210\u8D85\u65F6 ms"),
    minLength: import_koishi2.Schema.number().min(0).default(4).description("\u6700\u77ED\u89E6\u53D1\u6587\u672C\u957F\u5EA6\uFF08\u5B57\u7B26\uFF09"),
    maxLength: import_koishi2.Schema.number().min(0).default(120).description("\u6700\u957F\u89E6\u53D1\u6587\u672C\u957F\u5EA6\uFF08\u5B57\u7B26\uFF09"),
    cooldownSeconds: import_koishi2.Schema.number().min(0).default(60).description("\u540C\u6E20\u9053\u51B7\u5374\u79D2"),
    groupOnly: import_koishi2.Schema.boolean().default(true).description("\u4EC5\u7FA4\u804A\u914D\u8BED\u97F3"),
    onMentionOnly: import_koishi2.Schema.boolean().default(false).description("\u4EC5\u88AB @ \u65F6\u914D\u8BED\u97F3"),
    replaceText: import_koishi2.Schema.boolean().default(true).description("\u547D\u4E2D\u65F6\u541E\u6389 yesimbot \u6587\u672C\u53EA\u53D1\u8BED\u97F3\uFF08TTS \u5931\u8D25\u81EA\u52A8\u8865\u53D1\u6587\u672C\uFF09"),
    napcatHttpUrl: import_koishi2.Schema.string().default("http://mita_napcat:6199").description("NapCat HTTP API\uFF08QQ \u8BED\u97F3\u76F4\u53D1\uFF09"),
    ttsSpeed: import_koishi2.Schema.number().min(0.5).max(2).step(0.05).default(1.2).description("\u5408\u6210\u8BED\u901F\uFF08CV3 \u89C4\u8303\u63A8\u8350 1.2\uFF1B1.0 \u504F\u6162\u30011.3 \u504F\u5FEB\uFF09"),
    loudnorm: import_koishi2.Schema.boolean().default(true).description("\u5408\u6210\u540E\u505A\u54CD\u5EA6\u5F52\u4E00\u5316\u5230 -20 LUFS\uFF08\u8D70\u670D\u52A1\u7AEF /loudnorm\uFF1B\u7AEF\u70B9\u4E0D\u53EF\u7528\u81EA\u52A8\u8DF3\u8FC7\uFF09"),
    ttsTailPadMs: import_koishi2.Schema.number().min(0).max(2e3).default(400).description("\u5408\u6210 WAV \u672B\u5C3E\u8FFD\u52A0\u9759\u97F3 ms\uFF08\u9632 QQ Silk \u5E27\u7F16\u7801\u541E\u6389\u672B\u97F3\u8282\uFF1B0=\u4E0D\u586B\u5145\uFF09")
  }).description("\u9AD8\u7EA7\u8BBE\u7F6E\uFF08\u4E00\u822C\u4E0D\u7528\u52A8\uFF09")
});
function apply(ctx, config) {
  const logger = ctx.logger("aka-yesimbot-voice");
  const adv = config.advanced;
  const tts = new TtsClient({
    apiBase: adv.ttsApiBase,
    timeoutMs: adv.ttsTimeoutMs,
    tailPadMs: adv.ttsTailPadMs,
    speed: adv.ttsSpeed,
    loudnorm: adv.loudnorm
  });
  const absVoiceDir = resolveVoiceDir(ctx, config.voiceDir);
  const outputDir = outputDirOf(absVoiceDir);
  const voices = new VoiceLibrary(absVoiceDir);
  const settingsPath = (0, import_node_path2.join)((0, import_node_path2.dirname)(absVoiceDir), "settings.json");
  function readSavedVoice() {
    try {
      const { readFileSync: readFileSync3 } = require("fs");
      const data = JSON.parse(readFileSync3(settingsPath, "utf8"));
      if (typeof data.voice === "string" && data.voice) return data.voice;
    } catch {
    }
    return void 0;
  }
  function saveVoice(name2) {
    try {
      const { writeFileSync, mkdirSync } = require("fs");
      mkdirSync((0, import_node_path2.dirname)(settingsPath), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify({ voice: name2 }, null, 2), "utf8");
    } catch (err) {
      logger.warn("save voice settings failed: %s", err instanceof Error ? err.message : String(err));
    }
  }
  function resolveCurrentVoice() {
    const saved = readSavedVoice();
    if (saved) return saved;
    return "auto";
  }
  let llmChannel = null;
  if (config.llm) {
    llmChannel = fromYesimbot(ctx, { logger });
    if (!llmChannel) logger.warn("llm channel yesimbot unavailable \u2014 falling back to rules");
  }
  const renderOpts = {
    llm: llmChannel,
    fidelityRatio: 0.95,
    // zero_shot 下 [breath] 等韵律标记会导致模型提前截断→音频不完整，关闭注入（最终文本还会统一剥除标记）
    injectBreath: false,
    timeoutMs: 6e4,
    prompt: DEFAULT_LLM_PROMPT,
    logPrompts: false,
    logger
  };
  async function renderVoice(text) {
    const voice = currentVoice();
    const prompt = composeVoicePrompt(voice?.stylePrompt);
    return render(text, { ...renderOpts, prompt });
  }
  const policyCfg = {
    ttsEnabled: true,
    probability: config.probability,
    minLength: adv.minLength,
    maxLength: adv.maxLength,
    cooldownSeconds: adv.cooldownSeconds,
    groupOnly: adv.groupOnly,
    onMentionOnly: adv.onMentionOnly
  };
  const FORCE_VOICE_TTL = 12e4;
  function voiceState(bot) {
    const b = bot;
    return b._akaVoiceState ??= {
      pendingVoice: /* @__PURE__ */ new Map(),
      turnSegments: /* @__PURE__ */ new Map(),
      forceVoiceChannels: /* @__PURE__ */ new Map(),
      lastSpeakAt: /* @__PURE__ */ new Map()
    };
  }
  function isForceArmed(st, channelId) {
    const exp = st.forceVoiceChannels.get(channelId);
    if (exp === void 0) return false;
    if (Date.now() > exp) {
      st.forceVoiceChannels.delete(channelId);
      return false;
    }
    return true;
  }
  function currentVoice() {
    const requested = resolveCurrentVoice();
    const voice = voices.resolve(requested);
    const resolved = voice?.name ?? null;
    if (requested && requested !== "auto" && requested !== resolved) {
      logger.warn(
        "voice resolve MISMATCH: requested=%s resolved=%s (fallback) \u2014 check settings.json / voiceDir files",
        requested,
        resolved
      );
    }
    return voice;
  }
  function consumePending(channelId, bot, platform) {
    const st = voiceState(bot);
    const item = st.pendingVoice.get(channelId);
    if (!item || item.consumed) return;
    item.consumed = true;
    if (item.timer) clearTimeout(item.timer);
    st.pendingVoice.delete(channelId);
    const text = item.text;
    void (async () => {
      try {
        const rendered = await renderVoice(text);
        const voice = currentVoice();
        const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, voice ?? void 0);
        await sendVoice(bot, channelId, out.wavPath, platform, adv.napcatHttpUrl);
        st.lastSpeakAt.set(channelId, Date.now());
        logger.info(
          "voice sent (text replaced) channel=%s voice=%s path=%s len=%d dur=%dms source=%s ratio=%s degraded=%s loudnorm=%s%s rendered=%s",
          channelId,
          voice?.name ?? "none",
          voice?.path ?? "",
          out.pcmBytes,
          out.durationMs,
          rendered.source,
          rendered.ratio.toFixed(3),
          rendered.degraded,
          String(out.loudnormApplied ?? false),
          rendered.reason ? ` reason=${rendered.reason}` : "",
          rendered.text.slice(0, 40)
        );
      } catch (err) {
        logger.warn("voice failed, fallback text channel=%s: %s", channelId, err instanceof Error ? err.message : String(err));
        try {
          await bot.sendMessage(channelId, text);
          logger.info("fallback text sent channel=%s", channelId);
        } catch (fallbackErr) {
          logger.warn("fallback text also failed channel=%s: %s", channelId, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
        }
      }
    })();
  }
  function queuePending(bot, channelId, platform, text) {
    const st = voiceState(bot);
    const existing = st.pendingVoice.get(channelId);
    if (existing && !existing.consumed) {
      existing.text = existing.text.length > text.length ? existing.text : text;
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = setTimeout(() => consumePending(channelId, bot, platform), 600);
      return;
    }
    const timer = setTimeout(() => consumePending(channelId, bot, platform), 600);
    st.pendingVoice.set(channelId, { text, timer, consumed: false });
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
  ctx.command("voice [name]", "\u8BED\u97F3\u8BBE\u7F6E\uFF1A.voice \u67E5\u770B\u5F53\u524D/\u5168\u90E8\u97F3\u8272\uFF1B.voice <\u97F3\u8272\u540D> \u5207\u6362").action(async ({ session }, name2) => {
    if (!session) return "\u9700\u8981\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u3002";
    const list = voices.scan();
    if (!name2) {
      const current = voices.resolve(resolveCurrentVoice());
      if (!list.length) return "\u97F3\u8272\u76EE\u5F55\u4E3A\u7A7A\uFF1A\u5F80 voiceDir \u653E\u5165 *.wav\uFF08\u91CD\u542F\u751F\u6548\uFF09\u3002";
      const lines = list.map((v) => `${v.name === current?.name ? "\u25CF " : "\u25CB "}${v.name}`).join("\n");
      return `\u5F53\u524D\u97F3\u8272\uFF1A${current?.name ?? "\uFF08\u65E0\uFF09"}
\u53EF\u7528\u97F3\u8272\uFF1A
${lines}

\u7528 .voice <\u97F3\u8272\u540D> \u5207\u6362`;
    }
    const found = list.find((v) => v.name === name2);
    if (!found) return `\u6CA1\u6709\u97F3\u8272\u300C${name2}\u300D\u3002\u7528 .voice \u67E5\u770B\u53EF\u7528\u5217\u8868\u3002`;
    saveVoice(name2);
    logger.info("voice switched to %s by user", name2);
    return `\u2705 \u5DF2\u5207\u6362\u5230\u97F3\u8272\u300C${name2}\u300D\uFF08\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F\u4E0D\u4E22\uFF09\u3002`;
  });
  ctx.command("\u8BF4 [text:text]", "\u8BF4 <\u5185\u5BB9>\uFF1A\u7528\u5F53\u524D\u97F3\u8272\u76F4\u63A5\u8BF4\u51FA\u8BE5\u5185\u5BB9").action(async ({ session }, text) => {
    if (!session) return;
    const content = (text ?? "").trim();
    if (!content) return;
    const cid = String(session.channelId ?? session.cid ?? "");
    const bot = session.bot;
    const platform = session.platform;
    if (!cid || !bot) return;
    void (async () => {
      try {
        const rendered = await renderVoice(content);
        const voice = currentVoice();
        if (!voice) {
          logger.warn("\u8BF4: no voice configured, no-op channel=%s", cid);
          return;
        }
        const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, voice);
        await sendVoice(bot, cid, out.wavPath, platform, adv.napcatHttpUrl);
        logger.info(
          "\u8BF4 direct speak channel=%s voice=%s len=%d dur=%dms source=%s ratio=%s loudnorm=%s",
          cid,
          voice.name,
          out.pcmBytes,
          out.durationMs,
          rendered.source,
          rendered.ratio.toFixed(3),
          String(out.loudnormApplied ?? false)
        );
      } catch (err) {
        logger.warn("\u8BF4 direct speak failed channel=%s: %s", cid, err instanceof Error ? err.message : String(err));
      }
    })();
    return;
  });
  const yesimbot = ctx.yesimbot;
  if (!yesimbot?.registerChannelPlugin) {
    logger.warn("yesimbot service unavailable \u2014 plugin inactive");
    return;
  }
  yesimbot.registerChannelPlugin(({ bot, scope }) => {
    const channelId = scope.channelId;
    const platform = scope.platform;
    const isShared = scope.type === "shared";
    if (adv.replaceText && platform === "onebot" && !bot._akaVoicePatched) {
      ;
      bot._akaVoicePatched = true;
      const origSend = bot.sendMessage.bind(bot);
      bot.sendMessage = (async (cid, content, ...rest) => {
        const text = extractSendText(content);
        const cidStr = String(cid);
        const st = voiceState(bot);
        if (text && isShared && !st.pendingVoice.has(cidStr)) {
          const segments = st.turnSegments.get(cidStr) ?? [];
          const isTurnReply = segments.includes(text);
          const forced = isForceArmed(st, cidStr);
          if (forced) {
            st.forceVoiceChannels.delete(cidStr);
            logger.info("text replaced by voice (forced) channel=%s reason=force-voice text=%s", cidStr, text.slice(0, 30));
            queuePending(bot, cidStr, platform, text);
            return [];
          }
          if (isTurnReply) {
            const decision = decide(policyCfg, {
              text,
              channelId: cidStr,
              isShared,
              mentioned: false,
              now: Date.now(),
              lastSpeakAt: st.lastSpeakAt.get(cidStr) ?? 0
            });
            if (decision.speak) {
              logger.info("text replaced by voice channel=%s reason=%s text=%s", cidStr, decision.reason, text.slice(0, 30));
              queuePending(bot, cidStr, platform, text);
              return [];
            }
            logger.info("text kept (voice skip) channel=%s reason=%s text=%s", cidStr, decision.reason, text.slice(0, 30));
          }
        } else if (text && st.pendingVoice.has(cidStr)) {
          queuePending(bot, cidStr, platform, text);
          return [];
        }
        return origSend(cid, content, ...rest);
      });
      logger.info("aka-yesimbot-voice: sendMessage patched (replaceText)");
    }
    const plugin = {
      name: "aka-yesimbot-voice",
      // 给 yesimbot LLM 注册正式语音工具：米塔想用语音「喊话/强调/应群友要求」时说出去时调用本工具，
      // 而不是靠 prompt 标记或概率。execute 只给当前频道的 forceVoiceChannels 打强制语音标记，
      // 复用 sendMessage patch 的 force-voice 截流通道（100% 走语音，不做策略判定）。
      // 注：用 AgentPlugin.tools（非 deprecated 的 extendTools）。运行时对 tools 与 extendTools 都是
      // merge 语义（mergeTools([nextTools, declared])），都会与基础工具(sendMessage/read 等)合并、不会覆盖；
      // tools 是官方推荐字段（extendTools 为兼容保留）。
      tools: [
        {
          name: "use_voice",
          description: "\u628A\u300C\u672C\u6761\u56DE\u590D\u300D\u7528\u8BED\u97F3\uFF08QQ \u8BED\u97F3\u6D88\u606F\uFF09\u8BF4\u51FA\u800C\u4E0D\u662F\u7EAF\u6587\u672C\u53D1\u9001\u3002\u9002\u7528\u573A\u666F\uFF1A\u7FA4\u53CB\u660E\u786E\u8981\u6C42\u4F60\u7528\u8BED\u97F3\u3001\u6216\u4F60\u60F3\u7528\u300C\u558A\u8BDD/\u5F3A\u8C03/\u6709\u60C5\u7EEA\u300D\u7684\u65B9\u5F0F\u8868\u8FBE\u67D0\u53E5\u8BDD\u65F6\u3002\u8C03\u7528\u540E\u672C\u8F6E\u4F60\u7684\u6587\u672C\u56DE\u590D\u4F1A\u88AB\u8F6C\u6210\u8BED\u97F3\u53D1\u51FA\u3002\u5E73\u65F6\u4E0D\u8981\u7528\uFF0C\u4EC5\u5728\u7528\u6237\u8981\u6C42\u6216\u4F60\u60F3\u5F3A\u8C03\u8BED\u6C14\u65F6\u8C03\u7528\u3002",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => {
            voiceState(bot).forceVoiceChannels.set(channelId, Date.now() + FORCE_VOICE_TTL);
            logger.info("use_voice tool invoked channel=%s voice=%s", channelId, resolveCurrentVoice());
            return "\u5DF2\u8BBE\u7F6E\uFF1A\u672C\u6761\u56DE\u590D\u5C06\u7528\u8BED\u97F3\u53D1\u9001\u3002";
          }
        }
      ],
      // 记录本 turn 的 <message> 段，供 sendMessage patch 匹配（只吞 yesimbot 回复）
      async onAppend(entries) {
        if (!adv.replaceText) return;
        for (const entry of entries) {
          if (entry?.type !== "message") continue;
          const data = entry.data;
          if (data?.role !== "assistant") continue;
          const segments = extractTurnSegments(data.content);
          if (segments.length > 0) {
            voiceState(bot).turnSegments.set(channelId, segments);
          }
        }
      },
      // replaceText 模式：turn 结束立即消费；否则在 turn 结束按策略附带语音
      async onTurnFinish(result) {
        const st = voiceState(bot);
        if (adv.replaceText) {
          const item = st.pendingVoice.get(channelId);
          if (item && !item.consumed) {
            consumePending(channelId, bot, platform);
          }
          return;
        }
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
          lastSpeakAt: st.lastSpeakAt.get(channelId) ?? 0
        });
        if (!decision.speak) {
          logger.info("skip voice channel=%s reason=%s text=%s", channelId, decision.reason, text.slice(0, 30));
          return;
        }
        void (async () => {
          try {
            const rendered = await renderVoice(text);
            const voice = currentVoice();
            const out = await tts.synthesize(rendered.text, outputDir, `voice-${Date.now()}.wav`, voice ?? void 0);
            await sendVoice(bot, channelId, out.wavPath, platform, adv.napcatHttpUrl);
            st.lastSpeakAt.set(channelId, Date.now());
            logger.info(
              "voice sent channel=%s voice=%s path=%s len=%d dur=%dms source=%s ratio=%s degraded=%s loudnorm=%s%s wav=%s",
              channelId,
              voice?.name ?? "none",
              voice?.path ?? "",
              out.pcmBytes,
              out.durationMs,
              rendered.source,
              rendered.ratio.toFixed(3),
              rendered.degraded,
              String(out.loudnormApplied ?? false),
              rendered.reason ? ` reason=${rendered.reason}` : "",
              out.wavPath
            );
          } catch (err) {
            logger.warn("voice failed channel=%s: %s", channelId, err instanceof Error ? err.message : String(err));
          }
        })();
      }
    };
    return plugin;
  });
  const voiceName = (() => {
    const v = voices.resolve(resolveCurrentVoice());
    return v ? v.name : "(none)";
  })();
  logger.info(
    "aka-yesimbot-voice registered (voice=%s, llm=%s, replaceText=%s, voiceDir=%s)",
    voiceName,
    config.llm ? llmChannel ? "yesimbot" : "rules-fallback" : "off",
    adv.replaceText,
    absVoiceDir
  );
}
function resolveVoiceDir(ctx, voiceDir) {
  if ((0, import_node_path2.isAbsolute)(voiceDir)) return voiceDir;
  const baseDir = ctx.baseDir ?? process.cwd();
  return (0, import_node_path2.join)(baseDir, voiceDir);
}
function outputDirOf(voiceDir) {
  return (0, import_node_path2.dirname)(voiceDir);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
//# sourceMappingURL=index.js.map