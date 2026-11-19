// supabase/functions/_shared/translation_providers/openai_compatible.ts
//
// Plugin: translates through any server that speaks the OpenAI chat completions API
// (OpenAI, Azure OpenAI, Groq, Together, Mistral, or a self-hosted Ollama, vLLM or
// LM Studio server), so no single vendor is required.
//
// Env vars:
//   RUDO_TRANSLATION_API_URL   base URL including /v1, e.g. http://localhost:11434/v1
//   RUDO_TRANSLATION_MODEL     model name the server knows
//   RUDO_TRANSLATION_API_KEY   optional, sent as a Bearer token when set

import {
  buildTranslationPrompt,
  parseTranslationOutput,
  type TranslationProvider,
} from "../translation_types.ts";

export const openAiCompatibleTranslationProvider: TranslationProvider = {
  name: "openai-compatible",

  isConfigured() {
    return !!Deno.env.get("RUDO_TRANSLATION_API_URL") && !!Deno.env.get("RUDO_TRANSLATION_MODEL");
  },

  supports() {
    return true;
  },

  async translate(text, from, to, ctx) {
    const baseUrl = (Deno.env.get("RUDO_TRANSLATION_API_URL") ?? "").replace(/\/+$/, "");
    const model = Deno.env.get("RUDO_TRANSLATION_MODEL");
    if (!baseUrl || !model) {
      throw new Error("RUDO_TRANSLATION_API_URL / RUDO_TRANSLATION_MODEL not set");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = Deno.env.get("RUDO_TRANSLATION_API_KEY");
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2048,
        messages: [{ role: "user", content: buildTranslationPrompt(text, from, to, ctx.purpose) }],
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    const raw = await response.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    if (!response.ok) throw new Error(`Translation API returned ${response.status}`);

    const choice = raw.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("Translation was cut off");
    const translation = parseTranslationOutput(choice?.message?.content ?? "");
    if (!translation) throw new Error("Translation API returned an empty translation");
    return translation;
  },
};
