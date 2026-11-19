import { decodeBase64 } from "jsr:@std/encoding/base64";
import type { TtsProvider } from "./types.ts";
import { normalizeLang } from "./lang.ts";
import { callFunction, clipText } from "./util.ts";

const FUNCTION_NAME = "sahara-tts";
const MAX_CHARS = 4096;

type Voice = { language: string; accent: string; gender: "male" | "female" };

// SAHARA_VOICES='{"bemba":{"language":"...","accent":"...","gender":"female"}}'
// Keys are canonical language keys. A language is "supported" only if configured here.
function voices(): Record<string, Voice> {
  try {
    return JSON.parse(Deno.env.get("SAHARA_VOICES") ?? "{}");
  } catch {
    console.error("SAHARA_VOICES is not valid JSON; Sahara disabled");
    return {};
  }
}

const MIME: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" };

export const sahara: TtsProvider = {
  name: "sahara",
  supports: (lang) => !!voices()[normalizeLang(lang) ?? ""],

  async synthesize({ text, lang, authorization }) {
    const key = normalizeLang(lang) ?? lang;
    const v = voices()[key];
    if (!v) throw new Error(`sahara: no voice configured for "${key}"`);

    const clipped = clipText(text, MAX_CHARS);
    const json = await callFunction(FUNCTION_NAME, {
      text: clipped.text,
      voice_language: v.language,
      voice_accent: v.accent,
      voice_gender: v.gender,
      output_audio_format: "wav",
    }, authorization);

    if (!json.audio_base64) throw new Error("sahara: response had no audio");
    const fmt = String(json.output_audio_format ?? "wav");
    return {
      audio: decodeBase64(json.audio_base64),
      mime: MIME[fmt] ?? `audio/${fmt}`,
      durationSeconds: json.audio_duration_in_seconds ?? null,
      truncated: clipped.truncated,
    };
  },
};