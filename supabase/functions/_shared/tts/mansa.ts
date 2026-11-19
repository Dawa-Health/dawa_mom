import { decodeBase64 } from "jsr:@std/encoding/base64";
import type { TtsProvider } from "./types.ts";
import { normalizeLang } from "./lang.ts";

const SUPPORTED = new Set(["english", "shona", "bemba", "chinyanja", "ndebele"]);

export const mansa: TtsProvider = {
  name: "mansa",
  supports: (lang) => SUPPORTED.has(normalizeLang(lang) ?? ""),

  async synthesize({ text, lang, authorization }) {
    const url = Deno.env.get("SUPABASE_URL");
    if (!url) throw new Error("mansa: SUPABASE_URL not set");
    if (!authorization) throw new Error("mansa: missing caller authorization");

    const res = await fetch(`${url}/functions/v1/mansa-tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ text, language: normalizeLang(lang) }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`mansa: ${res.status} ${json?.error ?? "upstream error"}`);
    }
    if (!json.audio_base64) throw new Error("mansa: response had no audio");

    return {
      audio: decodeBase64(json.audio_base64),
      mime: "audio/wav",
      durationSeconds: json.audio_duration_in_seconds ?? null,
      truncated: !!json.truncated,
    };
  },
};