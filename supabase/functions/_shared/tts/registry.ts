// supabase/functions/_shared/tts/registry.ts
import { mansa } from "./mansa.ts";
import { sahara } from "./sahara.ts";
import { elevenlabs } from "./elevenlabs.ts";
import { normalizeLang } from "./lang.ts";
import type { TtsInput, TtsProvider } from "./types.ts";

const ALL: Record<string, TtsProvider> = { mansa, sahara, elevenlabs };

// Built-in default: Mansa first, ElevenLabs as fallback.
// Providers that don't support a language are skipped automatically.
const DEFAULT_CHAIN = ["mansa", "elevenlabs" , "sahara"];

// Optional per-language overrides via secret, using canonical keys:
// TTS_ROUTES='{"default":["mansa","elevenlabs"],"tonga":["elevenlabs"]}'
function routes(): Record<string, string[]> {
  try {
    return JSON.parse(Deno.env.get("TTS_ROUTES") ?? "{}");
  } catch {
    console.error("TTS_ROUTES is not valid JSON; using built-in defaults");
    return {};
  }
}

export function chain(lang: string): TtsProvider[] {
  const key = normalizeLang(lang) ?? lang;
  const r = routes();
  const names = r[key] ?? r.default ?? DEFAULT_CHAIN;

  return names
    .map((n) => {
      const p = ALL[n];
      if (!p) console.error(`TTS_ROUTES references unknown provider "${n}"`);
      return p;
    })
    .filter((p): p is TtsProvider => !!p && p.supports(key));
}

// True if at least one provider in the chain can speak this language.
// Use it to show or hide the speaker icon in the app.
export function isSupported(lang: string): boolean {
  return chain(lang).length > 0;
}

export async function synthesize(input: TtsInput) {
  const providers = chain(input.lang);
  if (!providers.length) {
    throw new Error(`No TTS provider supports "${input.lang}"`);
  }

  const errors: string[] = [];
  for (const p of providers) {
    try {
      return { ...(await p.synthesize(input)), provider: p.name };
    } catch (e) {
      errors.push(`${p.name}: ${e instanceof Error ? e.message : e}`);
      console.error("TTS provider failed, trying next", p.name, e);
    }
  }
  throw new Error(`All TTS providers failed. ${errors.join(" | ")}`);
}