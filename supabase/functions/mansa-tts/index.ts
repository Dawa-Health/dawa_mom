import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

// Self-contained on purpose: the Mansa helper is inlined below instead of
// living in _shared/, because the deploy bundler could not resolve a new
// _shared/mansa.ts. Only ../_shared/cors.ts (already deployed) is imported.
//
// Env: MANSA_API_KEY, MANSA_API_BASE_URL (https://api.mymansa.ai),
//      optional MANSA_TTS_MAX_CHARS (default 1000).
//
// TTS coverage: english, shona, bemba, chinyanja (Mansa: chichewa), ndebele.
// Not supported: tonga, lozi.

// engine language key -> Mansa TTS language slug
const TTS_LANGUAGES: Record<string, string> = {
  english: "english",
  shona: "shona",
  bemba: "bemba",
  chinyanja: "chichewa",
  ndebele: "ndebele",
};

// English uses the South African female accent. Every other language uses
// the plain "female" voice, which speaks that language natively. Do not use
// the "{language}_female_speaker" voices: those speak English.
const TTS_VOICES: Record<string, string> = {
  english: "south_african_female",
};
const DEFAULT_VOICE = "female";

const LANGUAGE_ALIASES: Record<string, string> = {
  en: "english",
  sn: "shona",
  nd: "ndebele",
  nde: "ndebele",
  bem: "bemba",
  ny: "chinyanja",
  nya: "chinyanja",
  nyanja: "chinyanja",
  chichewa: "chinyanja",
};

const TTS_SUPPORTED: string[] = Object.keys(TTS_LANGUAGES);

// "en", "sn-ZW", "Shona", "nyanja" -> engine key. Unknown values are returned
// lowercased so the caller can report them.
function normalizeLanguage(raw?: string | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (!key) return null;
  return LANGUAGE_ALIASES[key] ?? key;
}

function cleanForTts(text: string, maxChars: number): { text: string; truncated: boolean } {
  const flat = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return { text: flat, truncated: false };
  const cut = flat.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return { text: end > maxChars / 2 ? cut.slice(0, end + 1) : cut, truncated: true };
}

// Best-effort duration from a WAV header, so clients that used Sahara's
// audio_duration_in_seconds keep working. Returns null if it cannot tell.
function wavDurationSeconds(b: Uint8Array): number | null {
  try {
    if (b.length < 44) return null;
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "RIFF") return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const byteRate = v.getUint32(28, true);
    if (byteRate <= 0) return null;
    let off = 12;
    while (off + 8 <= b.length) {
      const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
      const size = v.getUint32(off + 4, true);
      if (id === "data") {
        const len = Math.min(size, b.length - (off + 8));
        return Math.round((len / byteRate) * 100) / 100;
      }
      off += 8 + size + (size % 2);
    }
  } catch {
    // fall through
  }
  return null;
}

type TtsResult =
  | {
    ok: true;
    audioBase64: string;
    durationSeconds: number | null;
    truncated: boolean;
    voice: string;
  }
  | { ok: false; status: number; error: string };

async function synthesizeSpeech(text: string, language: string): Promise<TtsResult> {
  const apiKey = Deno.env.get("MANSA_API_KEY");
  const baseUrl = (Deno.env.get("MANSA_API_BASE_URL") ?? "").replace(/\/+$/, "");
  if (!apiKey || !baseUrl) {
    return { ok: false, status: 500, error: "MANSA_API_KEY / MANSA_API_BASE_URL is not configured" };
  }

  const slug = TTS_LANGUAGES[language];
  if (!slug) {
    return {
      ok: false,
      status: 400,
      error: `Voice replies are not available for '${language}'. Supported: ${TTS_SUPPORTED.join(", ")}`,
    };
  }

  const maxChars = parseInt(Deno.env.get("MANSA_TTS_MAX_CHARS") ?? "1000", 10) || 1000;
  const cleaned = cleanForTts(text, maxChars);
  if (!cleaned.text) {
    return { ok: false, status: 400, error: "text is empty" };
  }

  const voice = TTS_VOICES[language] ?? DEFAULT_VOICE;

  // TEMP DIAGNOSTIC: remove once spend is confirmed.
  let host = "invalid-url";
  try {
    host = new URL(baseUrl).host;
  } catch {
    // leave as invalid-url
  }
  console.log(
    "[mansa-tts] request",
    JSON.stringify({
      host,
      endpoint: "/v1/audio/speech",
      keyPrefix: apiKey.slice(0, 6),
      keyLength: apiKey.length,
      language,
      slug,
      voice,
      chars: cleaned.text.length,
    }),
  );

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ text: cleaned.text, language: slug, voice, stream: false }),
    });
  } catch (error) {
    console.error("[mansa-tts] fetch failed", error instanceof Error ? error.message : error);
    return {
      ok: false,
      status: 502,
      error: `Could not reach Mansa TTS: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  // TEMP DIAGNOSTIC: log status plus any headers that look billing/usage related.
  const interesting: Record<string, string> = {};
  resp.headers.forEach((value, name) => {
    if (/credit|usage|cost|bill|balance|request-id|ratelimit|server|via/i.test(name)) {
      interesting[name] = value;
    }
  });
  console.log(
    "[mansa-tts] response",
    JSON.stringify({
      status: resp.status,
      contentType: resp.headers.get("content-type"),
      headers: interesting,
    }),
  );

  if (!resp.ok) {
    const raw = await resp.text().catch(() => "");
    console.error("[mansa-tts] upstream error", resp.status, raw.slice(0, 1000));
    let message = `Mansa TTS returned ${resp.status}`;
    try {
      const parsed = JSON.parse(raw);
      const detail = parsed?.message ?? parsed?.error?.message ?? parsed?.error;
      if (typeof detail === "string" && detail) message = detail;
    } catch {
      // body was not JSON, keep the generic message
    }
    // Do not pass Mansa's 401/403 through: the client would read it as its own
    // session being invalid. Rate limits are passed through so clients can back off.
    return { ok: false, status: resp.status === 429 ? 429 : 502, error: message };
  }

  const bytes = new Uint8Array(await resp.arrayBuffer());
  console.log("[mansa-tts] audio bytes", bytes.length); // TEMP DIAGNOSTIC
  if (bytes.length === 0) {
    return { ok: false, status: 502, error: "Mansa TTS returned empty audio" };
  }

  return {
    ok: true,
    audioBase64: encodeBase64(bytes),
    durationSeconds: wavDurationSeconds(bytes),
    truncated: cleaned.truncated,
    voice,
  };
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Mansa TTS (replaces Sahara TTS).
// Docs: https://platform.mymansa.ai/docs/speech
// - One synchronous call, binary WAV back. No audio_path to download and no
//   503 status polling, so the old text-id handling is gone.
// - Voice is chosen here, not by the client: English uses south_african_female,
//   every other language uses the plain female voice.
//
// Request (new):    { "text": "...", "language": "english" | "shona" | "bemba" | "chinyanja" | "ndebele" }
// Request (legacy): { "text": "...", "voice_language": "en", "voice_accent": "...", "voice_gender": "female" }
//   voice_language is still read as the language. voice_accent, voice_gender
//   and output_audio_format are ignored (output is always WAV).
// Response: { audio_base64, audio_duration_in_seconds, output_audio_format: "wav", language, truncated }

type TtsRequest = {
  text?: string;
  language?: string;
  voice_language?: string;
  voice_accent?: string;
  voice_gender?: string;
  output_audio_format?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "Supabase function environment is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  let body: TtsRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const text = body.text?.trim();
  if (!text) {
    return jsonResponse({ error: "text is required" }, 400);
  }

  const language = normalizeLanguage(body.language ?? body.voice_language) ?? "english";
  if (!TTS_SUPPORTED.includes(language)) {
    return jsonResponse(
      { error: `Voice replies are not available for '${language}'`, supported: TTS_SUPPORTED },
      400,
    );
  }

  const result = await synthesizeSpeech(text, language);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status);
  }

  return jsonResponse({
    audio_base64: result.audioBase64,
    audio_duration_in_seconds: result.durationSeconds,
    output_audio_format: "wav",
    language,
    truncated: result.truncated,
  });
});