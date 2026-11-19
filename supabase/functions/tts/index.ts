import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { synthesize, isSupported } from "../_shared/tts/registry.ts";
import { normalizeLang } from "../_shared/tts/lang.ts";

type TtsRequest = {
  text?: string;
  language?: string;
  voice_language?: string; // legacy alias
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
  const { data: { user }, error: userError } = await supabase.auth.getUser();
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
  if (!text) return jsonResponse({ error: "text is required" }, 400);

  const language = normalizeLang(body.language ?? body.voice_language) ?? "english";
  if (!isSupported(language)) {
    return jsonResponse({ error: `Voice replies are not available for '${language}'` }, 400);
  }

  try {
    const out = await synthesize({ text, lang: language, authorization });
    return jsonResponse({
      audio_base64: encodeBase64(out.audio),
      audio_duration_in_seconds: out.durationSeconds ?? null,
      output_audio_format: out.mime === "audio/wav" ? "wav" : out.mime,
      mime: out.mime,
      language,
      provider: out.provider,
      truncated: out.truncated ?? false,
    });
  } catch (error) {
    console.error("[tts] failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "TTS failed" },
      502,
    );
  }
});