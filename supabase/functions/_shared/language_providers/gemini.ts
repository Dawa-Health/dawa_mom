// supabase/functions/_shared/language_providers/gemini.ts
//
// Plugin: classifies text with Google Gemini. Needs GEMINI_API_KEY.
// Optional: RUDO_GEMINI_MODEL (default gemini-2.5-flash).

import {
  buildClassifierPrompt,
  type ClassifyContext,
  type LanguageProvider,
  parseLanguageReply,
  type RudoLanguage,
} from "../language_types.ts";

const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

export const geminiProvider: LanguageProvider = {
  name: "gemini",

  isConfigured() {
    return !!Deno.env.get("GEMINI_API_KEY");
  },

  async classify(text: string, ctx: ClassifyContext): Promise<RudoLanguage | null> {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const model = Deno.env.get("RUDO_GEMINI_MODEL") ?? "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildClassifierPrompt(text) }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 16,
            // Flash models can spend the whole budget on hidden thinking.
            ...(model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
          safetySettings: SAFETY_SETTINGS,
        }),
        signal: AbortSignal.timeout(ctx.timeoutMs),
      },
    );
    const raw = await response.json().catch(() => ({})) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (!response.ok) throw new Error(`Gemini returned ${response.status}`);

    const output = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const guess = parseLanguageReply(output);
    if (!guess) {
      throw new Error(`Unrecognised classifier output (${output.slice(0, 20)})`);
    }
    return guess;
  },
};