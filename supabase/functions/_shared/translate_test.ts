// supabase/functions/_shared/translate_test.ts
//
// Unit tests for translate.ts and the Mansa translation plugin. No network: providers
// are fakes, and global fetch is stubbed for the Mansa test. All text is synthetic.
//
// Run from supabase/functions:
//   deno test --allow-env _shared/translate_test.ts

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { RudoLanguage } from "./language.ts";
import { translateText, TranslationError } from "./translate.ts";
import {
  buildTranslationPrompt,
  parseTranslationOutput,
  type TranslationProvider,
} from "./translation_types.ts";
import { mansaTranslationProvider } from "./translation_providers/mansa.ts";

function fakeProvider(
  name: string,
  behaviour: {
    configured?: boolean;
    supports?: (from: RudoLanguage, to: RudoLanguage) => boolean;
    translate?: (text: string, from: RudoLanguage, to: RudoLanguage) => Promise<string>;
  },
  calls: string[] = [],
): TranslationProvider {
  return {
    name,
    isConfigured: () => behaviour.configured ?? true,
    supports: (from, to) => behaviour.supports?.(from, to) ?? true,
    translate: (text, from, to) => {
      calls.push(`${name}:${from}->${to}`);
      return behaviour.translate?.(text, from, to) ?? Promise.resolve(`[${name}] ${text}`);
    },
  };
}

Deno.test("same language is returned as is, without calling a provider", async () => {
  const calls: string[] = [];
  const result = await translateText("  What should I eat?  ", "english", "english", {
    purpose: "question",
    providers: [fakeProvider("a", {}, calls)],
  });
  assertEquals(result, { text: "What should I eat?", source: "none" });
  assertEquals(calls, []);
});

Deno.test("text without letters is not sent anywhere", async () => {
  const calls: string[] = [];
  const result = await translateText("12 👍", "shona", "english", {
    purpose: "question",
    providers: [fakeProvider("a", {}, calls)],
  });
  assertEquals(result.source, "none");
  assertEquals(calls, []);
});

Deno.test("skips unconfigured and unsupported providers and uses the first that works", async () => {
  const calls: string[] = [];
  const result = await translateText("Mhoro", "shona", "english", {
    purpose: "question",
    providers: [
      fakeProvider("off", { configured: false }, calls),
      fakeProvider("no-shona", { supports: (from) => from !== "shona" }, calls),
      fakeProvider("good", { translate: () => Promise.resolve("Hello") }, calls),
      fakeProvider("never", {}, calls),
    ],
  });
  assertEquals(result.text, "Hello");
  assertEquals(result.source, "good");
  assertEquals(calls, ["good:shona->english"]);
});

Deno.test("falls through on errors and empty output", async () => {
  const calls: string[] = [];
  const result = await translateText("Mhoro", "shona", "english", {
    purpose: "question",
    providers: [
      fakeProvider("broken", { translate: () => Promise.reject(new Error("503")) }, calls),
      fakeProvider("empty", { translate: () => Promise.resolve("   ") }, calls),
      fakeProvider("good", { translate: () => Promise.resolve(" Hello ") }, calls),
    ],
  });
  assertEquals(result, {
    text: "Hello",
    source: "good",
    errors: ["broken: 503", "empty: empty translation"],
  });
  assertEquals(calls, ["broken:shona->english", "empty:shona->english", "good:shona->english"]);
});

Deno.test("throws TranslationError, with every reason, when nothing works", async () => {
  const error = await assertRejects(
    () =>
      translateText("Mhoro", "shona", "english", {
        purpose: "question",
        providers: [
          fakeProvider("off", { configured: false }),
          fakeProvider("broken", { translate: () => Promise.reject(new Error("503")) }),
        ],
      }),
    TranslationError,
  );
  assertStringIncludes(error.message, "off: not configured");
  assertStringIncludes(error.message, "broken: 503");
});

Deno.test("unknown names in RUDO_TRANSLATION_PROVIDERS are reported", async () => {
  Deno.env.set("RUDO_TRANSLATION_PROVIDERS", "nope");
  try {
    const error = await assertRejects(
      () => translateText("Mhoro", "shona", "english", { purpose: "question" }),
      TranslationError,
    );
    assertStringIncludes(error.message, "nope: unknown provider");
  } finally {
    Deno.env.delete("RUDO_TRANSLATION_PROVIDERS");
  }
});

Deno.test("parseTranslationOutput strips wrapping that models add", () => {
  assertEquals(parseTranslationOutput("<text>\nMhoro\n</text>"), "Mhoro");
  assertEquals(parseTranslationOutput("```\nMhoro\n```"), "Mhoro");
  assertEquals(parseTranslationOutput('"Mhoro"'), "Mhoro");
  // Quotes inside the text are kept.
  assertEquals(parseTranslationOutput('Say "yes" to the nurse'), 'Say "yes" to the nurse');
});

Deno.test("the translation prompt names both languages and forbids answering", () => {
  const prompt = buildTranslationPrompt("Ndine nhumbu", "shona", "english", "question");
  assertStringIncludes(prompt, "from Shona (chiShona, Zimbabwe) to English");
  assertStringIncludes(prompt, "Do not answer the text");
  assertStringIncludes(prompt, "<text>\nNdine nhumbu\n</text>");
});

// --- Mansa plugin -----------------------------------------------------------

async function withMansaEnv(
  env: Record<string, string>,
  fetchStub: typeof fetch,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch;
  const keys = ["MANSA_API_KEY", "MANSA_API_BASE_URL", "MANSA_TRANSLATE_LANGUAGES"];
  const saved = Object.fromEntries(keys.map((k) => [k, Deno.env.get(k)]));
  for (const k of keys) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  globalThis.fetch = fetchStub;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    for (const k of keys) {
      if (saved[k] === undefined) Deno.env.delete(k);
      else Deno.env.set(k, saved[k]!);
    }
  }
}

Deno.test("Mansa: sends language names, tone and context, and reads data.translation", async () => {
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  let seenAuth = "";
  await withMansaEnv(
    { MANSA_API_KEY: "test-key", MANSA_API_BASE_URL: "https://mansa.example/" },
    (input, init) => {
      seenUrl = String(input);
      seenAuth = new Headers(init?.headers).get("Authorization") ?? "";
      seenBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(JSON.stringify({ data: { translation: "What food should I eat?" } })),
      );
    },
    async () => {
      assert(mansaTranslationProvider.isConfigured());
      const out = await mansaTranslationProvider.translate(
        "Ndofanira kudya chikafu chipi?",
        "shona",
        "english",
        { purpose: "question", timeoutMs: 1000 },
      );
      assertEquals(out, "What food should I eat?");
    },
  );
  assertEquals(seenUrl, "https://mansa.example/v1/translate");
  assertEquals(seenAuth, "Bearer test-key");
  assertEquals(seenBody.from, "Shona");
  assertEquals(seenBody.to, "English");
  assertEquals(seenBody.tone, "precise");
  assert(typeof seenBody.context === "string");
});

Deno.test("Mansa: Nyanja is sent as Chichewa; Tonga and Lozi are off until configured", async () => {
  await withMansaEnv({ MANSA_API_KEY: "k", MANSA_API_BASE_URL: "https://m" }, fetch, () => {
    assert(mansaTranslationProvider.supports("english", "chinyanja"));
    assert(!mansaTranslationProvider.supports("english", "tonga"));
    assert(!mansaTranslationProvider.supports("lozi", "english"));
    return Promise.resolve();
  });
  await withMansaEnv(
    {
      MANSA_API_KEY: "k",
      MANSA_API_BASE_URL: "https://m",
      MANSA_TRANSLATE_LANGUAGES: '{"tonga":"Tonga"}',
    },
    fetch,
    () => {
      assert(mansaTranslationProvider.supports("english", "tonga"));
      return Promise.resolve();
    },
  );
});

Deno.test("Mansa: an error reply throws with the API's detail", async () => {
  await withMansaEnv(
    { MANSA_API_KEY: "k", MANSA_API_BASE_URL: "https://m" },
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Unsupported language" }), { status: 400 }),
      ),
    async () => {
      await assertRejects(
        () =>
          mansaTranslationProvider.translate("Hi", "english", "shona", {
            purpose: "answer",
            timeoutMs: 1000,
          }),
        Error,
        "400: Unsupported language",
      );
    },
  );
});
