import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { askMedGemma, type MedGemmaTurn } from "../_shared/medgemma.ts";
import { detectLanguage, normalizeLanguage, type RudoLanguage } from "../_shared/language.ts";
// Reused as-is so the existing rudo-chat function is not modified.
import {
  looksLikeBookingMessage,
  parseStructuredAction,
  runBookingTurn,
  type BookingAction,
  type BookingState,
  type ServiceRow,
} from "../rudo-chat/booking.ts";

type ChatRequest = {
  message?: string;
  audio_base64?: string;
  filename?: string;
  mime_type?: string;
  // Confirm-before-send: transcribe the audio and return the transcript only.
  // Nothing is stored and no model is called, so the patient can fix the text first.
  transcribe_only?: boolean;
  // Language key from the app (english, shona, bemba, chinyanja, ...).
  // Wins over metadata.language.
  language?: string;
  // The user picked this language explicitly, so the voice API must not
  // auto-detect a different one.
  language_locked?: boolean;
  // Real clip length from the app, forwarded to the voice API for billing.
  duration_seconds?: number;
  session_id?: string;
  client_message_id?: string;
  metadata?: Record<string, unknown>;
};

type Reply = {
  reply: string;
  raw: Record<string, unknown>;
  source: string;
  handoff?: boolean;
};
type HistoryTurn = {
  role: string;
  content: string;
  source?: string | null;
  payload?: Record<string, unknown> | null;
};
type ChatRoute = "agent" | "greeting" | "company" | "medical";

const HISTORY_TURNS = 8;

// The Flutter client times out at 45s (text) and 60s (voice). The function has to answer
// before that, so every slow step gets a budget carved out of these deadlines.
const TEXT_DEADLINE_MS = 40_000;
const VOICE_DEADLINE_MS = 55_000;
const GEMINI_RESERVE_MS = 8_000; // kept free so the Gemini fallback can still answer
const MAX_AUDIO_BASE64_CHARS = 14_000_000; // roughly 10 MB of audio

const VOICE_RETRY_REPLY =
  "I couldn't hear that clearly. Please try again, a little closer to your phone.";

// Languages the Mansa speech-to-text supports. Anything else (ndebele, tonga, lozi)
// gets a friendly "type instead" notice in transcribe-only mode.
const STT_LANGUAGES = new Set(["english", "shona", "bemba", "chinyanja"]);

// The only languages where the Gemini transcription fallback is allowed.
// For Shona, Bemba and Nyanja Gemini is unreliable and invents plausible text
// instead of failing, so those languages fail loudly and the user can retry or type.
const GEMINI_STT_LANGUAGES = new Set(["english"]);

const LANGUAGE_ALIASES: Record<string, string> = {
  en: "english",
  sn: "shona",
  bem: "bemba",
  ny: "chinyanja",
  nya: "chinyanja",
  nyanja: "chinyanja",
  chichewa: "chinyanja",
};
const VOICE_UNSUPPORTED_REPLY =
  "Sorry, voice isn't available in your language yet. Please type your message instead, or use voice in English, Shona, Bemba or Nyanja";

function voiceLanguageKey(language: string): string {
  const key = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

// Error codes the voice API returns when the clip has no usable speech (silent,
// too short, or unintelligible). For these the Gemini transcription fallback is
// skipped on purpose: Gemini only invents text for such audio.
const NO_SPEECH_VOICE_ERRORS = new Set([
  "audio_silent",
  "audio_too_short",
  "unclear_audio",
]);

// ---------------------------------------------------------------------------
// Old Rudo bot details (ported from the WhatsApp bot's instructions file).
// ---------------------------------------------------------------------------
const COMPANY = {
  name: "Dawa Health",
  address: "No. 50 Lunsemfwa Rd, Kalundu, Lusaka, Zambia",
  email: "hello@dawa-health.com",
  website: "https://dawa-health.com/",
  phone: "+260 977 985 063",
};
const HUMAN_AGENT_NUMBER = Deno.env.get("RUDO_AGENT_NUMBER") ?? "+263719835124";

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  English: ["hie", "hi", "hey", "hello", "good morning", "good afternoon", "good evening"],
  Shona: ["mhoro", "mhoroi", "makadini", "hesi"],
  Ndebele: ["sawubona", "unjani", "salibonani"],
  Tonga: ["mwabuka buti", "mwalibizya buti", "kwasiya", "mulibuti"],
  Chinyanja: ["bwanji", "muli bwanji", "mukuli bwanji"],
  Bemba: ["muli shani", "mulishani", "mwashibukeni"],
  Lozi: ["muzuhile", "mutozi", "muzuhile cwani"],
};

const GREETING_PATTERN = new RegExp(
  `^(?:${
    Object.values(LANGUAGE_KEYWORDS).flat()
      .sort((a, b) => b.length - a.length)
      .join("|")
  })(?:\\s+(?:rudo|dawa\\s?mom|dawa))?[\\s!.,?]*$`,
  "i",
);

const AGENT_PATTERN =
  /(speak|talk|chat|connect)\s+(to|with)\s+(a\s+|an\s+|the\s+)?(human|person|agent|someone|representative|nurse|staff)|human agent|real person|customer (care|service)/i;

// Questions about Dawa Health's own services, prices and contact details.
const COMPANY_PATTERN =
  /\b(prices?|pricing|costs?|how much|kwacha|offers?|available|availability|in stock|buy|order|services?|products?|catalogue|catalog|opening hours|address|phone number|contact|email|website|dawa health)\b/i;

// English-only safety net; the model prompt also tells it to escalate red flags.
const RED_FLAG_PATTERN =
  /heavy bleeding|severe headache|seizure|convuls|\bfits\b|faint|chest pain|trouble breathing|can'?t breathe|reduced (fetal )?movement|not moving|severe (abdominal|stomach) pain|blurred vision/i;
const RED_FLAG_NOTICE =
  "What you describe can be serious. Please go to the nearest clinic or hospital now, or call your local emergency number.\n\n";

// Tokens the old bot used to signal actions. They are never shown to the patient.
const HANDOFF_TOKEN_PATTERN = /\b(agent_request|unable_to_solve_query)\b/i;
const ANY_TOKEN_PATTERN = /\b(agent_request|unable_to_solve_query|product_image)\b/gi;

// ---------------------------------------------------------------------------
// Logging helpers. Logs structured JSON, one line per event, tagged with a
// short request id (rid) so you can follow a single request in the Logs tab.
// NOTE: message text and transcripts are deliberately NOT logged (patient health
// data); only lengths, ids, routes and status codes are.
// ---------------------------------------------------------------------------
function log(rid: string, event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ rid, event, ...data }));
}
function logError(rid: string, event: string, error: unknown, data: Record<string, unknown> = {}) {
  console.error(JSON.stringify({
    rid,
    event,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...data,
  }));
}

console.log(JSON.stringify({ event: "boot", at: new Date().toISOString() }));

Deno.serve(async (req) => {
  const rid = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  log(rid, "request_received", { method: req.method, url: new URL(req.url).pathname });

  try {
    const res = await handle(req, rid, startedAt);
    log(rid, "request_done", { status: res.status, ms: Date.now() - startedAt });
    return res;
  } catch (error) {
    logError(rid, "unhandled_exception", error, { ms: Date.now() - startedAt });
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

async function handle(req: Request, rid: string, startedAt: number): Promise<Response> {
  const respond = (body: Record<string, unknown>, status = 200) => {
    log(rid, "respond", {
      status,
      error: typeof body.error === "string" ? body.error : undefined,
      duplicate: body.duplicate === true ? true : undefined,
    });
    return jsonResponse(body, status);
  };

  if (req.method === "OPTIONS") {
    log(rid, "cors_preflight");
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return respond({ error: "Missing Authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    log(rid, "env_missing", { hasUrl: !!supabaseUrl, hasAnonKey: !!supabaseAnonKey });
    return respond({ error: "Supabase function environment is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    log(rid, "auth_failed", { reason: userError?.message ?? "no user" });
    return respond({ error: "Invalid or expired session" }, 401);
  }
  log(rid, "auth_ok", { userId: user.id });

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch (error) {
    logError(rid, "invalid_json", error);
    return respond({ error: "Invalid JSON body" }, 400);
  }

  // Key names and lengths only, never content (patient health data).
  log(rid, "body_shape", {
    keys: Object.keys(body),
    audioType: typeof body.audio_base64,
    audioLength: typeof body.audio_base64 === "string" ? body.audio_base64.length : 0,
    transcribeOnly: body.transcribe_only === true ? true : undefined,
    languageLocked: body.language_locked === true ? true : undefined,
  });

  const metadata = body.metadata ?? {};
  const phoneNumber = stringOrNull(metadata.phone_number);
  const userName = stringOrNull(metadata.user_name);
  // The top-level `language` field (sent by the voice flow) wins over metadata.
  // This is the language from the app's settings. For text turns it is only the
  // fallback: the language of the actual text is detected below.
  const language = stringOrNull(body.language) ?? stringOrNull(metadata.language) ??
    "English";

  // -------------------------------------------------------------------------
  // Voice notes: transcribe first, then treat the transcript like a typed message.
  // -------------------------------------------------------------------------
  const audioBase64 = typeof body.audio_base64 === "string" ? body.audio_base64 : "";
  const hasAudio = audioBase64.length > 0;
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return respond({ error: "Audio is too large" }, 413);
  }
  if (body.transcribe_only === true && !hasAudio) {
    return respond({ error: "transcribe_only requires audio_base64" }, 400);
  }

  // NEW: audio must go through confirm-before-send. The app transcribes first,
  // the user edits the text, then the app sends it as a normal `message`.
  if (hasAudio && body.transcribe_only !== true) {
    log(rid, "audio_without_confirm_rejected");
    return respond({
      error:
        "Voice notes must be confirmed first. Send transcribe_only: true, then send the edited text as a message.",
    }, 400);
  }

  let message = body.message?.trim() ?? "";
  if (hasAudio) {
    const voiceLanguage = voiceLanguageKey(language);

    // No speech-to-text for this language. Tell the app to let the user type.
    if (body.transcribe_only === true && !STT_LANGUAGES.has(voiceLanguage)) {
      log(rid, "voice_language_unsupported", { language: voiceLanguage });
      return respond({
        transcript: "",
        transcript_valid: false,
        voice_supported: false,
        language: voiceLanguage,
        reply: VOICE_UNSUPPORTED_REPLY,
        transcript_only: true,
      });
    }

    let transcript = "";
    try {
      transcript = await transcribeAudio({
        userId: user.id,
        audioBase64,
        filename: stringOrNull(body.filename) ?? "voice_note.m4a",
        mimeType: stringOrNull(body.mime_type) ?? "audio/mp4",
        language: voiceLanguage, // normalised key ("shona", "chinyanja", ...)
        languageLocked: body.language_locked === true,
        durationSeconds: typeof body.duration_seconds === "number" && body.duration_seconds > 0
          ? body.duration_seconds
          : null,
        rid,
      });
    } catch (error) {
      logError(rid, "transcription_failed", error);
      return respond({ error: "Could not transcribe the voice note" }, 502);
    }
    if (!transcript) {
      // Friendly reply instead of an error so the app can speak it and keep listening.
      log(rid, "transcript_empty");
      return respond({
        reply: VOICE_RETRY_REPLY,
        message: VOICE_RETRY_REPLY,
        transcript: "",
        transcript_valid: false,
        voice_supported: true,
        language: voiceLanguage,
        action: null,
        transcript_only: true,
      });
    }

    // Confirm-before-send. Return the transcript only. Nothing is saved, no session
    // is created and no model is called until the patient confirms the text.
    log(rid, "transcribe_only_done", { transcriptLength: transcript.length });
    return respond({
      transcript,
      transcript_valid: true,
      voice_supported: true,
      language: voiceLanguage,
      transcript_only: true,
    });
  }

  if (!message) {
    return respond({ error: "Message is required" }, 400);
  }
  log(rid, "body_parsed", {
    input: "text",
    messageLength: message.length,
    hasSessionId: !!body.session_id,
    hasClientMessageId: !!body.client_message_id,
  });

  // Start language detection now so it runs while the catalog loads. It never throws:
  // on any failure it resolves to the app's language.
  const detectionPromise = detectLanguage(message, language);

  const { data: serviceCatalogRows, error: catalogError } = await supabase
    .from("service_catalog")
    .select("id,external_service_id,name,description,category,is_paid,price,currency")
    .eq("is_active", true)
    .order("name");
  if (catalogError) {
    logError(rid, "service_catalog_failed", catalogError);
  }
  const serviceCatalog: ServiceRow[] = (serviceCatalogRows ?? []) as ServiceRow[];
  log(rid, "service_catalog_loaded", { count: serviceCatalog.length });

  // The language of the (possibly edited) text itself. This drives the reply language
  // and is returned to the app so it can pick the right text-to-speech voice.
  const detected = await detectionPromise;
  const replyLanguage = detected.language;
  log(rid, "language_detected", {
    appLanguage: voiceLanguageKey(language),
    detected: replyLanguage,
    source: detected.source,
    error: detected.error,
  });

  // `language` is replaced with the detected language so the reply (and the Gemini
  // fallback prompt) follows what the patient actually wrote, not the app setting.
  const rudoMetadata = { ...metadata, language: replyLanguage, service_catalog: serviceCatalog };

  const sessionResult = await getOrCreateSession(supabase, user.id, body.session_id, {
    phoneNumber,
    userName,
  });
  if ("error" in sessionResult) {
    log(rid, "session_failed", { reason: sessionResult.error, status: sessionResult.status });
    return respond({ error: sessionResult.error }, sessionResult.status);
  }

  const sessionId = sessionResult.sessionId;
  const clientMessageId = body.client_message_id?.trim() || null;
  log(rid, "session_ready", { sessionId, created: !body.session_id });

  const { error: userMessageError } = await supabase.from("chat_messages").insert({
    session_id: sessionId,
    role: "user",
    client_message_id: clientMessageId,
    source: "edge_function",
    content: message,
    payload: {
      type: "user_message",
      input: "text",
      message,
      session_id: sessionId,
      client_message_id: clientMessageId,
      metadata: rudoMetadata,
    },
    metadata: { ...metadata, dedupe_enabled: clientMessageId !== null },
  });

  if (userMessageError) {
    if (userMessageError.code === "23505") {
      log(rid, "duplicate_message", { sessionId, clientMessageId });
      return respond({
        duplicate: true,
        session_id: sessionId,
        message: "Duplicate client_message_id ignored",
      });
    }
    logError(rid, "user_message_insert_failed", userMessageError, { code: userMessageError.code });
    return respond({ error: userMessageError.message }, 500);
  }
  log(rid, "user_message_saved", { sessionId });

  const { data: sessionRow, error: sessionRowError } = await supabase
    .from("chat_sessions")
    .select("session_state")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionRowError) {
    logError(rid, "session_state_load_failed", sessionRowError);
  }
  const priorBookingState: BookingState =
    (sessionRow?.session_state as { booking?: BookingState } | null)?.booking ?? {};
  const hasActiveBooking = Object.keys(priorBookingState).length > 0;
  const isBookingTurn = parseStructuredAction(message) !== null ||
    looksLikeBookingMessage(message, hasActiveBooking);
  log(rid, "route_decided", {
    route: isBookingTurn ? "booking" : "chat",
    hasActiveBooking,
  });

  let reply: Reply;
  let bookingAction: BookingAction | null = null;
  let nextBookingState: BookingState = priorBookingState;

  if (isBookingTurn) {
    try {
      const turn = await runBookingTurn({
        supabase,
        supabaseUrl,
        authorization,
        message,
        priorState: priorBookingState,
        serviceCatalog,
        geminiApiKey: Deno.env.get("GEMINI_API_KEY") ?? null,
        geminiModel: Deno.env.get("RUDO_GEMINI_MODEL") ?? "gemini-2.5-flash",
      });
      reply = {
        reply: turn.reply,
        raw: { reply: turn.reply, action: turn.action },
        source: "rudo_booking",
      };
      bookingAction = turn.action;
      nextBookingState = turn.state;
      log(rid, "booking_turn_done", {
        actionType: (turn.action as { type?: string } | null)?.type ?? null,
        replyLength: turn.reply?.length ?? 0,
      });
    } catch (error) {
      logError(rid, "booking_turn_failed", error, { sessionId });
      return respond({
        error: error instanceof Error ? error.message : "Booking reply failed",
        session_id: sessionId,
      }, 502);
    }
  } else {
    try {
      reply = await generateChatReply({
        supabase,
        sessionId,
        message,
        metadata: rudoMetadata,
        rid,
        deadlineAt: startedAt + TEXT_DEADLINE_MS,
      });
    } catch (error) {
      logError(rid, "chat_reply_failed", error, { sessionId });
      return respond({
        error: error instanceof Error ? error.message : "Chat reply failed",
        session_id: sessionId,
      }, 502);
    }
  }
  log(rid, "reply_generated", {
    source: reply.source,
    replyLength: reply.reply.length,
    handoff: reply.handoff === true ? true : undefined,
  });

  const { error: assistantMessageError } = await supabase.from("chat_messages").insert({
    session_id: sessionId,
    role: "assistant",
    source: reply.source,
    content: reply.reply,
    payload: reply.raw,
    metadata: { backend_response: reply.raw, backend_source: reply.source },
  });
  if (assistantMessageError) {
    logError(rid, "assistant_message_insert_failed", assistantMessageError, {
      code: assistantMessageError.code,
    });
    return respond({ error: assistantMessageError.message }, 500);
  }
  log(rid, "assistant_message_saved", { sessionId });

  const { error: sessionUpdateError } = await supabase
    .from("chat_sessions")
    .update({
      last_message: reply.reply,
      last_message_at: new Date().toISOString(),
      session_state: {
        last_backend_response: reply.raw,
        booking: nextBookingState,
      },
    })
    .eq("id", sessionId);
  if (sessionUpdateError) {
    // Non-fatal: the reply was already saved, so still return it.
    logError(rid, "session_update_failed", sessionUpdateError);
  }

  return respond({
    reply: reply.reply,
    session_id: sessionId,
    action: bookingAction,
    handoff: reply.handoff === true,
    // Language of the patient's text, so the app can speak the reply with the right voice.
    language: replyLanguage,
  });
}

// ---------------------------------------------------------------------------
// Audio -> text
// ---------------------------------------------------------------------------
async function transcribeAudio(input: {
  userId: string;
  audioBase64: string;
  filename: string;
  mimeType: string;
  language: string;
  languageLocked: boolean; // trust `language`, do not auto-detect
  durationSeconds: number | null; // real clip length for billing
  rid: string;
}): Promise<string> {
  const { rid } = input;

  // Primary: the Vercel voice endpoint (Mansa STT for English, Shona, Bemba and Chichewa).
  // It is a Flask handler that reads multipart form fields (user_id, language,
  // language_locked, transcribe_only) and a file field named "audio". It returns
  // { transcript } or { text }.
  // When language_locked is "1" the handler should use `language` as is. Otherwise it
  // treats `language` as a prior and may pick the language it hears.
  const voiceUrl = Deno.env.get("RUDO_VOICE_API_URL");
  if (voiceUrl) {
    try {
      const t0 = Date.now();
      // No Content-Type here: fetch sets multipart/form-data with the right boundary.
      const headers: Record<string, string> = {};
      const voiceKey = Deno.env.get("RUDO_VOICE_API_KEY");
      if (voiceKey) headers.Authorization = `Bearer ${voiceKey}`;

      // Strip a "data:audio/...;base64," prefix if the app ever sends one.
      const cleanBase64 = input.audioBase64.replace(/^data:[^;]+;base64,/, "");
      const bytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));

      const form = new FormData();
      form.append("user_id", input.userId);
      form.append("language", input.language); // full name: "english", "shona", ...
      form.append("language_locked", input.languageLocked ? "1" : "0");
      form.append("transcribe_only", "1");
      // Lets the voice API bill the real duration instead of estimating it.
      if (input.durationSeconds && input.durationSeconds > 0) {
        form.append("duration_seconds", String(input.durationSeconds));
      }
      form.append("audio", new Blob([bytes], { type: input.mimeType }), input.filename);

      const response = await fetch(voiceUrl, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
      const apiError = stringOrNull(raw.error);

      // No-speech errors are recognised on non-200 responses as well, so
      // silent or unclear clips never reach the Gemini fallback.
      if (!response.ok) {
        if (apiError && NO_SPEECH_VOICE_ERRORS.has(apiError)) {
          log(rid, "voice_api_no_speech", { reason: apiError, status: response.status });
          return "";
        }
        throw new Error(
          `Voice API returned ${response.status}: ${apiError ?? "no error body"}`,
        );
      }

      const text = stringOrNull(raw.transcript) ?? stringOrNull(raw.text);
      log(rid, "voice_api_ok", { ms: Date.now() - t0, transcriptLength: text?.length ?? 0 });
      if (text) return text;

      // The voice API answered but deliberately gave no transcript because the clip had
      // no usable speech. An empty string makes the caller reply with the friendly
      // "try again" message.
      if (apiError && NO_SPEECH_VOICE_ERRORS.has(apiError)) {
        log(rid, "voice_api_no_speech", { reason: apiError });
        return "";
      }
      log(rid, "voice_api_empty_transcript", { keys: Object.keys(raw), error: apiError ?? undefined });
    } catch (error) {
      logError(rid, "voice_api_failed", error);
    }
  } else {
    log(rid, "voice_api_not_configured");
  }

  // Gemini transcription is English-only. For Shona, Bemba and Nyanja it
  // invents plausible text, so those languages fail with an error instead.
  if (!GEMINI_STT_LANGUAGES.has(input.language)) {
    log(rid, "gemini_stt_skipped", { language: input.language });
    throw new Error("Voice service unavailable for this language");
  }

  // Fallback: Gemini transcription (English). Best effort only: m4a/mp4 is not on
  // Gemini's official audio list.
  log(rid, "falling_back_to_gemini_stt");
  return await transcribeWithGemini(input);
}

async function transcribeWithGemini(input: {
  audioBase64: string;
  mimeType: string;
  language: string;
  rid: string;
}): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("No transcription service is configured");

  const model = Deno.env.get("RUDO_GEMINI_MODEL") ?? "gemini-2.5-flash";
  const t0 = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: input.mimeType, data: input.audioBase64 } },
            {
              text:
                `Transcribe this voice note exactly as spoken. The speaker is most likely using ${input.language}. ` +
                "Return only the transcript, with no commentary. If there is no speech, return an empty string.",
            },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 512, ...thinkingOff(model) },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    log(input.rid, "gemini_transcribe_http_error", { status: response.status, model });
    throw new Error(`Gemini transcription returned ${response.status}`);
  }
  const text = extractGeminiText(raw);
  log(input.rid, "gemini_transcribe_ok", { ms: Date.now() - t0, transcriptLength: text.length });
  return text;
}

// ---------------------------------------------------------------------------
// Chat replies
// ---------------------------------------------------------------------------
function routeMessage(message: string): ChatRoute {
  if (AGENT_PATTERN.test(message)) return "agent";
  if (GREETING_PATTERN.test(message.trim())) return "greeting";
  if (COMPANY_PATTERN.test(message)) return "company";
  return "medical";
}

function detectGreetingLanguage(message: string): string | null {
  const text = message.trim().toLowerCase();
  for (const [language, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
    if (keywords.some((k) => text.startsWith(k))) return language;
  }
  return null;
}

async function generateChatReply(input: {
  supabase: SupabaseClient<any>;
  sessionId: string;
  message: string;
  metadata: Record<string, unknown>;
  rid: string;
  deadlineAt: number;
}): Promise<Reply> {
  const { rid } = input;
  const redFlag = RED_FLAG_PATTERN.test(input.message);
  if (redFlag) log(rid, "red_flag_detected");
  // TODO: hook your high-risk detector / clinician notification here when redFlag is true.

  // Red flags always go to the medical route, whatever else the message mentions.
  const route: ChatRoute = redFlag ? "medical" : routeMessage(input.message);
  log(rid, "chat_route", { route });

  const history = await loadHistory(input.supabase, input.sessionId, input.message, rid);
  const catalog = (input.metadata.service_catalog ?? []) as ServiceRow[];

  // Greetings, human-agent requests, and questions about Dawa Health's products, prices
  // and contact details follow the old Rudo bot's rules (Gemini + service_catalog).
  if (route !== "medical") {
    const greetingLanguage = route === "greeting" ? detectGreetingLanguage(input.message) : null;
    const prompt = buildBotPrompt({
      message: input.message,
      metadata: input.metadata,
      history,
      catalog,
      languageOverride: greetingLanguage,
    });
    log(rid, "gemini_company_start", { promptLength: prompt.length });
    const t0 = Date.now();
    const text = await callGemini(prompt, rid);
    const { clean, handoff } = cleanBotText(text, route === "agent");
    log(rid, "gemini_company_ok", { ms: Date.now() - t0, replyLength: clean.length, handoff });
    return {
      reply: clean,
      raw: { reply: clean, model: "gemini_company", route: "company", handoff },
      source: "rudo_gemini_edge",
      handoff,
    };
  }

  // Everything else (maternal health questions) goes to MedGemma.
  // MedGemma was fine-tuned with a short system prompt that the Space adds itself, so it
  // gets just the question + recent pairs. The full prompt is only for the Gemini fallback.
  const targetLanguage: RudoLanguage =
    normalizeLanguage(stringOrNull(input.metadata.language)) ?? "english";
  // Only exchanges in the same language are sent as history. Earlier replies in another
  // language (for example Nyanja) make the model keep answering in that language.
  const medgemmaHistory = toMedGemmaHistory(history, targetLanguage);
  const prompt = buildBotPrompt({
    message: input.message,
    metadata: input.metadata,
    history,
    catalog,
    languageOverride: null,
  });
  log(rid, "prompt_built", {
    historyTurns: history.length,
    medgemmaPairs: medgemmaHistory.length,
    promptLength: prompt.length,
    targetLanguage,
  });

  // One MedGemma call, followed by a check that the reply really is in the patient's language.
  const callMedGemma = async (hist: MedGemmaTurn[], attempt: string) => {
    const budgetMs = Math.max(5_000, input.deadlineAt - Date.now() - GEMINI_RESERVE_MS);
    log(rid, "medgemma_call_start", { attempt, budgetMs, targetLanguage });
    const t0 = Date.now();
    const { text, raw } = await withTimeout(
      askMedGemma({
        question: withLanguageHint(input.message, targetLanguage),
        history: hist,
      }),
      budgetMs,
      "MedGemma",
    );
    log(rid, "medgemma_call_ok", { attempt, ms: Date.now() - t0, replyLength: text.length });

    // If the check itself fails, detectLanguage returns the target language, so an
    // unverifiable reply is let through rather than blocked.
    const check = await detectLanguage(text, targetLanguage);
    const matches = check.source !== "gemini" || check.language === targetLanguage;
    log(rid, "reply_language_checked", {
      attempt,
      target: targetLanguage,
      replyLanguage: check.language,
      source: check.source,
      matches,
    });
    return { text, raw, matches, replyLanguage: check.language };
  };

  try {
    let result = await callMedGemma(medgemmaHistory, "first");
    const timeLeft = input.deadlineAt - Date.now() - GEMINI_RESERVE_MS;
    if (!result.matches && timeLeft > 10_000) {
      log(rid, "medgemma_language_retry", {
        expected: targetLanguage,
        got: result.replyLanguage,
      });
      result = await callMedGemma([], "retry_no_history");
    }
    if (!result.matches) {
      throw new Error(`MedGemma replied in ${result.replyLanguage}, expected ${targetLanguage}`);
    }
    const finalText = redFlag ? RED_FLAG_NOTICE + result.text : result.text;
    return {
      reply: finalText,
      raw: {
        reply: finalText,
        model: "medgemma",
        route: "medical",
        red_flag: redFlag,
        reply_language: targetLanguage,
        space_response: result.raw,
      },
      source: "rudo_medgemma",
    };
  } catch (error) {
    logError(rid, "medgemma_failed_falling_back_to_gemini", error);
  }

  log(rid, "gemini_fallback_start");
  const t1 = Date.now();
  const text = await callGemini(prompt, rid);
  const { clean, handoff } = cleanBotText(text, false);
  log(rid, "gemini_fallback_ok", { ms: Date.now() - t1, replyLength: clean.length });
  const finalText = redFlag ? RED_FLAG_NOTICE + clean : clean;
  return {
    reply: finalText,
    raw: {
      reply: finalText,
      model: "gemini_fallback",
      route: "medical",
      reply_language: targetLanguage,
      red_flag: redFlag,
      handoff,
    },
    source: "rudo_gemini_edge",
    handoff,
  };
}

// Strips the old bot's action tokens from model text and reports whether a human
// follow-up was requested.
function cleanBotText(text: string, forceHandoff: boolean): { clean: string; handoff: boolean } {
  const handoff = forceHandoff || HANDOFF_TOKEN_PATTERN.test(text);
  const clean = text
    .replace(ANY_TOKEN_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { clean, handoff };
}

async function loadHistory(
  supabase: SupabaseClient<any>,
  sessionId: string,
  currentMessage: string,
  rid: string,
): Promise<HistoryTurn[]> {
  // ASSUMPTION: chat_messages has a created_at column.
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role,content,source,payload")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS + 1);
  if (error) {
    logError(rid, "history_load_failed", error);
  }

  const turns = ((data ?? []) as HistoryTurn[]).reverse();
  const last = turns[turns.length - 1];
  if (last && last.role === "user" && last.content === currentMessage) turns.pop();
  return turns.filter((t) => t.content?.trim());
}

const LANGUAGE_LABELS: Record<RudoLanguage, string> = {
  english: "English",
  shona: "Shona",
  ndebele: "Ndebele",
  chinyanja: "Chinyanja (Chichewa)",
  bemba: "Bemba",
  tonga: "Tonga",
  lozi: "Lozi",
};

// Tells MedGemma which language to answer in. English is left as the model was trained.
function withLanguageHint(question: string, language: RudoLanguage): string {
  if (language === "english") return question;
  return `${question}\n\n(Please reply in ${LANGUAGE_LABELS[language]} only.)`;
}

// Pairs consecutive user -> assistant turns into {user, model}. A pair is kept only when
// both the patient's message and Rudo's reply were in `targetLanguage` (the languages are
// stored on each row: payload.metadata.language on user rows, payload.reply_language on
// assistant rows). Older rows have no reply_language and are dropped. Booking replies and
// company/price replies are dropped too, so they don't steer the medical model.
function toMedGemmaHistory(history: HistoryTurn[], targetLanguage: RudoLanguage): MedGemmaTurn[] {
  const pairs: MedGemmaTurn[] = [];
  let pendingUser: { text: string; language: RudoLanguage | null } | null = null;
  for (const t of history) {
    if (t.role === "user") {
      const meta = t.payload?.metadata as Record<string, unknown> | undefined;
      pendingUser = {
        text: t.content,
        language: normalizeLanguage(stringOrNull(meta?.language)),
      };
    } else if (t.role === "assistant" && pendingUser !== null) {
      const isBooking = t.source === "rudo_booking";
      const isCompany = t.payload?.route === "company";
      const replyLanguage = normalizeLanguage(stringOrNull(t.payload?.reply_language));
      if (
        !isBooking && !isCompany &&
        pendingUser.language === targetLanguage && replyLanguage === targetLanguage
      ) {
        pairs.push({ user: pendingUser.text, model: t.content });
      }
      pendingUser = null;
    }
  }
  return pairs.slice(-2); // the Space also keeps only the last 2
}

// The old Rudo bot's instructions, adapted for the DawaMom app: the catalog comes from
// service_catalog instead of products_data.py, there is no WhatsApp registration/ID step,
// and there are no product images.
function buildBotPrompt(input: {
  message: string;
  metadata: Record<string, unknown>;
  history: HistoryTurn[];
  catalog: ServiceRow[];
  languageOverride: string | null;
}): string {
  const userName = stringOrNull(input.metadata.user_name);
  const language = input.languageOverride ?? stringOrNull(input.metadata.language) ?? "English";
  const catalog = input.catalog.map((s) => ({
    name: s.name,
    category: s.category,
    description: s.description,
    is_paid: s.is_paid,
    price: s.price,
    currency: s.currency,
  }));

  const transcript = input.history
    .map((t) => `${t.role === "user" ? "Patient" : "Rudo"}: ${t.content}`)
    .join("\n");

  return [
    `SYSTEM ROLE: You are Rudo, ${COMPANY.name}'s virtual assistant inside the DawaMom app. Speak as the company ("we"), not as an individual.`,
    "",
    "SCOPE:",
    `- Only answer questions about ${COMPANY.name}'s products and services, maternal health (pregnancy, period tracking, appointment preparation), and cervical cancer information.`,
    "- If a question is unrelated, politely decline and redirect to those topics.",
    "- If the user keeps asking off-topic questions, give a short, polite warning and do not continue with the off-topic subject.",
    "- If the message is a greeting, just respond to the greeting.",
    "",
    "TONE: Professional, friendly, supportive, clear and culturally appropriate. Use simple, natural wording and keep answers concise but useful.",
    "",
    "IDENTITY:",
    "- Introduce yourself as Rudo only when greeting.",
    `- When the user says "you" or "your" about services, they mean ${COMPANY.name}.`,
    "- The user is already signed in. Never ask for their name, phone digits or address, and never mention an ID.",
    "",
    `LANGUAGE: Respond entirely in ${language}. Keep medicine names, emergency numbers and clinic names unchanged.`,
    userName ? `Patient name: ${userName}.` : "",
    "",
    "SERVICES AND PRICES:",
    "- The service catalog below is the only source for what is offered and what it costs. Never invent a service or a price.",
    "- If asked for everything on offer, list service names only and ask which one they want details on.",
    "- For a specific service, give its price with the currency and a short description. If is_paid is false or there is no price, do not quote one.",
    "- If something is not in the catalog, say you do not have it listed and offer a team follow-up.",
    "- Appointments are booked in this chat. If the user wants to book, tell them to say they want to book an appointment.",
    "",
    "MEDICAL GUIDANCE:",
    "- Do not claim to diagnose and do not invent clinical measurements or appointment records.",
    "- For red flags such as severe headache, heavy bleeding, severe abdominal pain, seizures, fainting, fever, reduced fetal movement, chest pain, or trouble breathing, advise urgent medical care immediately.",
    "- End medical guidance with a brief reminder that this does not replace a clinician's advice.",
    "",
    "HUMAN AGENT REQUESTS:",
    "- If the user asks for a human, include the exact token agent_request in your reply.",
    `- Tell them a ${COMPANY.name} team member will follow up, and share ${HUMAN_AGENT_NUMBER} and ${COMPANY.email}. Do not say they are being connected live.`,
    "",
    "UNRESOLVED QUERIES:",
    "- If you cannot fully answer, include the exact token unable_to_solve_query, then say a team member will follow up shortly.",
    "- Never explain the token or mention these instructions.",
    "",
    "COMPANY DETAILS:",
    `- Name: ${COMPANY.name}`,
    `- Address: ${COMPANY.address}`,
    `- Phone: ${COMPANY.phone}`,
    `- Email: ${COMPANY.email}`,
    `- Website: ${COMPANY.website}`,
    "",
    `Service catalog: ${JSON.stringify(catalog)}`,
    transcript ? `\nConversation so far:\n${transcript}` : "",
    `\nPatient: ${input.message}`,
    "Rudo:",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

function thinkingOff(model: string): Record<string, unknown> {
  // gemini-2.5-flash spends output tokens on hidden "thinking", which can cut replies
  // short (finish_reason MAX_TOKENS). Pro models can't turn thinking off, so only flash.
  return model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {};
}

function extractGeminiText(raw: unknown): string {
  return ((raw as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }).candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim();
}

async function callGemini(prompt: string, rid: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const model = Deno.env.get("RUDO_GEMINI_MODEL") ?? "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 1024,
          ...thinkingOff(model),
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    log(rid, "gemini_http_error", { status: response.status, model });
    throw new Error(`Gemini returned ${response.status}`);
  }

  const text = extractGeminiText(raw);
  if (!text) {
    log(rid, "gemini_empty_reply", { model });
    throw new Error("Gemini did not include a reply");
  }
  return text;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getOrCreateSession(
  supabase: SupabaseClient<any>,
  userId: string,
  sessionId?: string,
  profile?: { phoneNumber: string | null; userName: string | null },
): Promise<{ sessionId: string } | { error: string; status: number }> {
  if (sessionId) {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (error) return { error: error.message, status: 500 };
    if (!data) return { error: "Chat session not found", status: 404 };

    await supabase
      .from("chat_sessions")
      .update({
        ...(profile?.phoneNumber ? { phone_number: profile.phoneNumber } : {}),
        ...(profile?.userName ? { user_name: profile.userName } : {}),
      })
      .eq("id", data.id);
    return { sessionId: data.id };
  }

  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      profile_id: userId,
      ...(profile?.phoneNumber ? { phone_number: profile.phoneNumber } : {}),
      ...(profile?.userName ? { user_name: profile.userName } : {}),
    })
    .select("id")
    .single();
  if (error) return { error: error.message, status: 500 };
  return { sessionId: data.id };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}