// supabase/functions/_shared/translation_providers/gemini.ts
//
// Plugin: translates with Google Gemini. Needs GEMINI_API_KEY.
// Optional: RUDO_TRANSLATION_GEMINI_MODEL, else RUDO_GEMINI_MODEL (default gemini-2.5-flash).

import {
  buildTranslationPrompt,
  parseTranslationOutput,
  type TranslationProvider,
} from "../translation_types.ts";

const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

export const geminiTranslationProvider: TranslationProvider = {
  name: "gemini",

  isConfigured() {
    return !!Deno.env.get("GEMINI_API_KEY");
  },

  supports() {
    return true;
  },

  async translate(text, from, to, ctx) {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const model = Deno.env.get("RUDO_TRANSLATION_GEMINI_MODEL") ??
      Deno.env.get("RUDO_GEMINI_MODEL") ?? "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildTranslationPrompt(text, from, to, ctx.purpose) }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            // Flash models can spend the whole budget on hidden thinking.
            ...(model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
          safetySettings: SAFETY_SETTINGS,
        }),
        signal: AbortSignal.timeout(ctx.timeoutMs),
      },
    );
    const raw = await response.json().catch(() => ({})) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };
    if (!response.ok) throw new Error(`Gemini returned ${response.status}`);

    const candidate = raw.candidates?.[0];
    // A cut-off translation could drop a warning sign, so treat it as a failure.
    if (candidate?.finishReason === "MAX_TOKENS") throw new Error("Gemini translation was cut off");
    const output = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const translation = parseTranslationOutput(output);
    if (!translation) throw new Error("Gemini returned an empty translation");
    return translation;
  },
};
