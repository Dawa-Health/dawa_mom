// supabase/functions/_shared/translation_providers/mansa.ts
//
// Plugin: translates with Mansa (African Languages Lab), the same service that already
// does Rudo's speech-to-text and text-to-speech. Uses the existing secrets:
//   MANSA_API_KEY, MANSA_API_BASE_URL (https://api.mymansa.ai)
//
// Request: POST {base}/v1/translate  { text, from, to, tone, context }
// Reply:   { data: { translation } }
// Check these against Mansa's translate docs (platform.mymansa.ai) when you deploy.
//
// Optional:
//   MANSA_TRANSLATE_LANGUAGES  JSON that overrides or extends the language names sent to
//                              Mansa, e.g. {"tonga":"Tonga","lozi":"Lozi"}. Set a language
//                              to "" to turn it off. Languages missing here are skipped,
//                              so the next provider (Gemini by default) handles them.
//   MANSA_TRANSLATE_TONE_QUESTION  tone for patient -> English. Default: precise
//   MANSA_TRANSLATE_TONE_ANSWER    tone for English -> patient. Default: natural

import type { RudoLanguage } from "../language.ts";
import {
  type TranslateContext,
  TRANSLATION_CONTEXT,
  type TranslationProvider,
} from "../translation_types.ts";

// Languages Mansa is known to speak for Rudo today (its TTS covers the same five).
// Tonga and Lozi are left out until you confirm Mansa translates them; add them with
// MANSA_TRANSLATE_LANGUAGES.
const DEFAULT_LANGUAGE_NAMES: Partial<Record<RudoLanguage, string>> = {
  english: "English",
  shona: "Shona",
  bemba: "Bemba",
  chinyanja: "Chichewa",
  ndebele: "Ndebele",
};

function languageNames(): Partial<Record<RudoLanguage, string>> {
  const raw = Deno.env.get("MANSA_TRANSLATE_LANGUAGES");
  if (!raw) return DEFAULT_LANGUAGE_NAMES;
  try {
    return { ...DEFAULT_LANGUAGE_NAMES, ...JSON.parse(raw) };
  } catch {
    console.error("MANSA_TRANSLATE_LANGUAGES is not valid JSON; using built-in names");
    return DEFAULT_LANGUAGE_NAMES;
  }
}

function tone(ctx: TranslateContext): string {
  return ctx.purpose === "question"
    ? Deno.env.get("MANSA_TRANSLATE_TONE_QUESTION") || "precise"
    : Deno.env.get("MANSA_TRANSLATE_TONE_ANSWER") || "natural";
}

type MansaTranslateReply = {
  data?: { translation?: string };
  detail?: string;
  title?: string;
  context?: string;
};

export const mansaTranslationProvider: TranslationProvider = {
  name: "mansa",

  isConfigured() {
    return !!Deno.env.get("MANSA_API_KEY") && !!Deno.env.get("MANSA_API_BASE_URL");
  },

  supports(from, to) {
    const names = languageNames();
    return !!names[from] && !!names[to];
  },

  async translate(text, from, to, ctx) {
    const apiKey = Deno.env.get("MANSA_API_KEY");
    const baseUrl = (Deno.env.get("MANSA_API_BASE_URL") ?? "").replace(/\/+$/, "");
    if (!apiKey || !baseUrl) {
      throw new Error("MANSA_API_KEY / MANSA_API_BASE_URL is not configured");
    }

    const names = languageNames();
    const response = await fetch(`${baseUrl}/v1/translate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        from: names[from],
        to: names[to],
        tone: tone(ctx),
        context: TRANSLATION_CONTEXT,
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    const raw = await response.json().catch(() => ({})) as MansaTranslateReply;
    if (!response.ok) {
      const detail = raw.detail || raw.title || raw.context;
      throw new Error(`Mansa translate returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const translation = raw.data?.translation?.trim();
    if (!translation) throw new Error("Mansa returned an empty translation");
    return translation;
  },
};
