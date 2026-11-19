import { decodeBase64 } from "jsr:@std/encoding/base64";
import type { TtsProvider } from "./types.ts";
import { normalizeLang } from "./lang.ts";
import { callFunction, clipText } from "./util.ts";

const FUNCTION_NAME = "elevenlabs-tts"; // change to your deployed function's name
const MAX_CHARS = 2500;

// Canonical keys ElevenLabs may speak. Default: English only.
// ELEVENLABS_LANGS="english,..." to extend.
function langs(): Set<string> {
  return new Set(
    (Deno.env.get("ELEVENLABS_LANGS") ?? "english")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}

export const elevenlabs: TtsProvider = {
  name: "elevenlabs",
  supports: (lang) => langs().has(normalizeLang(lang) ?? ""),

  async synthesize({ text, authorization }) {
    const clipped = clipText(text, MAX_CHARS);
    // Voice and model come from the function's own secrets
    // (ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID).
    const json = await callFunction(FUNCTION_NAME, { text: clipped.text }, authorization);

    if (!json.audio_base64) throw new Error("elevenlabs: response had no audio");
    return {
      audio: decodeBase64(json.audio_base64),
      mime: json.content_type ?? "audio/mpeg",
      truncated: clipped.truncated,
    };
  },
};