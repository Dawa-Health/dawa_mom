// supabase/functions/_shared/language.ts
//
// Detects which of Rudo's seven languages a message is written in. The detector itself
// is vendor neutral: it asks one or more LanguageProvider plugins (see
// ./language_providers/) and uses the first confident answer. Gemini is just one of
// those plugins.
//
// Never throws: on any problem it returns the fallback language so a chat reply
// is never blocked by detection.
//
// Configuration (all optional):
//   RUDO_LANGUAGE_PROVIDERS   comma separated provider names, tried in order.
//                             Default: gemini. Example: gemini,keywords
//   RUDO_LANGUAGE_TIMEOUT_MS  per provider network timeout. Default: 5000.

import {
  type LanguageProvider,
  normalizeLanguage,
  type RudoLanguage,
} from "./language_types.ts";
import { BUILT_IN_PROVIDERS } from "./language_providers/index.ts";

// Kept so existing imports from "_shared/language.ts" keep working.
export { normalizeLanguage, SUPPORTED_LANGUAGES } from "./language_types.ts";
export type { ClassifyContext, LanguageProvider, RudoLanguage } from "./language_types.ts";

export type DetectResult = {
  language: RudoLanguage;
  // The name of the provider that answered (for example "gemini" or "keywords"), or:
  //   fallback = no provider gave a confident answer, the app's language was kept
  //   skipped  = nothing to classify (no letters, or a structured booking action)
  source: string;
  error?: string;
};

export type DetectOptions = {
  // Use exactly these providers instead of the configured ones (handy in tests).
  providers?: LanguageProvider[];
  timeoutMs?: number;
};

const DEFAULT_PROVIDERS = "gemini";
const DEFAULT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
const registry = new Map<string, LanguageProvider>();
for (const provider of BUILT_IN_PROVIDERS) registry.set(provider.name, provider);

// Add a provider at runtime, or replace a built-in one with the same name.
export function registerLanguageProvider(provider: LanguageProvider): void {
  registry.set(provider.name, provider);
}

export function registeredLanguageProviders(): string[] {
  return [...registry.keys()];
}

function configuredProviders(): { providers: LanguageProvider[]; unknown: string[] } {
  const names = (Deno.env.get("RUDO_LANGUAGE_PROVIDERS") ?? DEFAULT_PROVIDERS)
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const providers: LanguageProvider[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const provider = registry.get(name);
    if (provider) providers.push(provider);
    else unknown.push(name);
  }
  return { providers, unknown };
}

function timeoutFromEnv(): number {
  const value = Number(Deno.env.get("RUDO_LANGUAGE_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
export async function detectLanguage(
  message: string,
  fallbackLanguage: string | null | undefined,
  options: DetectOptions = {},
): Promise<DetectResult> {
  const fallback = normalizeLanguage(fallbackLanguage) ?? "english";
  const text = message.trim();

  // Nothing to classify: digits/emoji only, or a structured booking button payload.
  if (!/\p{L}/u.test(text) || text.startsWith("__rudo_action__:")) {
    return { language: fallback, source: "skipped" };
  }

  const errors: string[] = [];
  let providers = options.providers;
  if (!providers) {
    const configured = configuredProviders();
    providers = configured.providers;
    for (const name of configured.unknown) errors.push(`${name}: unknown provider`);
  }
  if (!providers.length) {
    errors.push("no language provider configured");
    return { language: fallback, source: "fallback", error: errors.join("; ") };
  }

  const timeoutMs = options.timeoutMs ?? timeoutFromEnv();
  const input = text.slice(0, 500);

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      errors.push(`${provider.name}: not configured`);
      continue;
    }
    try {
      const guess = await provider.classify(input, { timeoutMs });
      if (!guess) {
        errors.push(`${provider.name}: no confident answer`);
        continue;
      }

      // Very short messages such as "ok", "thanks" or "hey" are ambiguous. Don't let
      // them flip a Shona or Bemba user to English.
      const wordCount = text.split(/\s+/).length;
      if (wordCount < 3 && guess === "english" && fallback !== "english") {
        return { language: fallback, source: "fallback" };
      }

      return { language: guess, source: provider.name };
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { language: fallback, source: "fallback", error: errors.join("; ") };
}