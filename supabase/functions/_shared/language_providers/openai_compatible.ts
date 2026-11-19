// supabase/functions/_shared/language_providers/openai_compatible.ts
//
// Plugin: classifies text through any server that speaks the OpenAI chat completions
// API. That covers OpenAI, Azure OpenAI, Groq, Together, Mistral, and self-hosted
// servers such as Ollama, vLLM and LM Studio, so no single vendor is required.
//
// Env vars:
//   RUDO_LANGUAGE_API_URL   base URL including /v1, e.g. http://localhost:11434/v1
//   RUDO_LANGUAGE_MODEL     model name the server knows, e.g. llama3.1:8b
//   RUDO_LANGUAGE_API_KEY   optional, sent as a Bearer token when set

import {
  buildClassifierPrompt,
  type ClassifyContext,
  type LanguageProvider,
  parseLanguageReply,
  type RudoLanguage,
} from "../language_types.ts";

export const openAiCompatibleProvider: LanguageProvider = {
  name: "openai-compatible",

  isConfigured() {
    return !!Deno.env.get("RUDO_LANGUAGE_API_URL") && !!Deno.env.get("RUDO_LANGUAGE_MODEL");
  },

  async classify(text: string, ctx: ClassifyContext): Promise<RudoLanguage | null> {
    const baseUrl = (Deno.env.get("RUDO_LANGUAGE_API_URL") ?? "").replace(/\/+$/, "");
    const model = Deno.env.get("RUDO_LANGUAGE_MODEL");
    if (!baseUrl || !model) throw new Error("RUDO_LANGUAGE_API_URL / RUDO_LANGUAGE_MODEL not set");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = Deno.env.get("RUDO_LANGUAGE_API_KEY");
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 16,
        messages: [{ role: "user", content: buildClassifierPrompt(text) }],
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    const raw = await response.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) throw new Error(`Language API returned ${response.status}`);

    const output = raw.choices?.[0]?.message?.content ?? "";
    const guess = parseLanguageReply(output);
    if (!guess) {
      throw new Error(`Unrecognised classifier output (${output.slice(0, 20)})`);
    }
    return guess;
  },
};