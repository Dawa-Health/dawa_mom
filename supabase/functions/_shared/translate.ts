// supabase/functions/_shared/translate.ts
//
// Translates text between Rudo's seven languages. Like ./language.ts it is vendor
// neutral: it asks one or more TranslationProvider plugins (see ./translation_providers/)
// in order and uses the first good answer.
//
// Unlike language detection, translation THROWS when every provider fails. Sending the
// untranslated text on would bring back the problem this exists to fix (MedGemma
// answering in a language it handles badly), so the caller must fall back instead.
//
// Configuration (all optional):
//   RUDO_TRANSLATION_PROVIDERS   comma separated provider names, tried in order.
//                                Default: mansa,gemini
//   RUDO_TRANSLATION_TIMEOUT_MS  per provider network timeout. Default: 12000.

import type { RudoLanguage } from "./language.ts";
import type { TranslationProvider, TranslationPurpose } from "./translation_types.ts";
import { BUILT_IN_TRANSLATION_PROVIDERS } from "./translation_providers/index.ts";

export type { TranslationProvider, TranslationPurpose } from "./translation_types.ts";

export type TranslateResult = {
  text: string;
  // Name of the provider that translated, or "none" when nothing had to be translated.
  source: string;
  // Why earlier providers were skipped or failed, when the first one did not answer.
  // Safe to log: these are status messages, never the patient's text.
  errors?: string[];
};

export type TranslateOptions = {
  purpose: TranslationPurpose;
  // Use exactly these providers instead of the configured ones (handy in tests).
  providers?: TranslationProvider[];
  // Per provider timeout. Callers pass less than the default when the reply deadline is near.
  timeoutMs?: number;
};

export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationError";
  }
}

const DEFAULT_PROVIDERS = "mansa,gemini";
export const DEFAULT_TRANSLATION_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
const registry = new Map<string, TranslationProvider>();
for (const provider of BUILT_IN_TRANSLATION_PROVIDERS) registry.set(provider.name, provider);

// Add a provider at runtime, or replace a built-in one with the same name.
export function registerTranslationProvider(provider: TranslationProvider): void {
  registry.set(provider.name, provider);
}

export function registeredTranslationProviders(): string[] {
  return [...registry.keys()];
}

function configuredProviders(): { providers: TranslationProvider[]; unknown: string[] } {
  const names = (Deno.env.get("RUDO_TRANSLATION_PROVIDERS") ?? DEFAULT_PROVIDERS)
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const providers: TranslationProvider[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const provider = registry.get(name);
    if (provider) providers.push(provider);
    else unknown.push(name);
  }
  return { providers, unknown };
}

export function translationTimeoutFromEnv(): number {
  const value = Number(Deno.env.get("RUDO_TRANSLATION_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TRANSLATION_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------
export async function translateText(
  text: string,
  from: RudoLanguage,
  to: RudoLanguage,
  options: TranslateOptions,
): Promise<TranslateResult> {
  const input = text.trim();
  // Nothing to do: same language, or no letters at all (digits, emoji).
  if (from === to || !/\p{L}/u.test(input)) return { text: input, source: "none" };

  const errors: string[] = [];
  let providers = options.providers;
  if (!providers) {
    const configured = configuredProviders();
    providers = configured.providers;
    for (const name of configured.unknown) errors.push(`${name}: unknown provider`);
  }

  const timeoutMs = options.timeoutMs ?? translationTimeoutFromEnv();

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      errors.push(`${provider.name}: not configured`);
      continue;
    }
    if (!provider.supports(from, to)) {
      errors.push(`${provider.name}: ${from}->${to} not supported`);
      continue;
    }
    try {
      const output = (await provider.translate(input, from, to, {
        timeoutMs,
        purpose: options.purpose,
      })).trim();
      if (!output) {
        errors.push(`${provider.name}: empty translation`);
        continue;
      }
      return errors.length
        ? { text: output, source: provider.name, errors }
        : { text: output, source: provider.name };
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new TranslationError(
    `Could not translate ${from}->${to}: ${
      errors.join("; ") || "no translation provider configured"
    }`,
  );
}
