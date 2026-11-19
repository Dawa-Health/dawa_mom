// supabase/functions/rudo-chat-medgemma/english_route_test.ts
//
// Unit tests for english_route.ts. No network: translation and MedGemma are fakes and
// the clock is controlled. All messages below are synthetic.
//
// Run from supabase/functions:
//   deno test --allow-env rudo-chat-medgemma/english_route_test.ts

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { RudoLanguage } from "../_shared/language.ts";
import type { MedGemmaTurn } from "../_shared/medgemma.ts";
import {
  answerInEnglish,
  type EnglishRouteDeps,
  type EnglishRouteInput,
  type HistoryTurnLike,
  toEnglishHistory,
} from "./english_route.ts";

const RED_FLAGS = /heavy bleeding|severe headache/i;
const NOTICE = "Please go to the nearest clinic now.\n\n";

type Call =
  | { kind: "translate"; text: string; from: RudoLanguage; to: RudoLanguage; purpose: string }
  | { kind: "medgemma"; question: string; history: MedGemmaTurn[]; timeoutMs: number };

function setup(overrides: Partial<EnglishRouteDeps> = {}, startAt = 0) {
  const calls: Call[] = [];
  let clock = startAt;
  const deps: EnglishRouteDeps = {
    translate: (text, from, to, options) => {
      calls.push({ kind: "translate", text, from, to, purpose: options.purpose });
      clock += 500;
      return Promise.resolve({ text: `<${to}> ${text}`, source: "fake" });
    },
    askMedGemma: (input, timeoutMs) => {
      calls.push({ kind: "medgemma", question: input.question, history: input.history, timeoutMs });
      clock += 3000;
      return Promise.resolve({ text: "Eat beans, greens and eggs.", raw: { event_id: "e1" } });
    },
    now: () => clock,
    log: () => {},
    translationTimeoutMs: 12_000,
    ...overrides,
  };
  return { calls, deps };
}

function input(overrides: Partial<EnglishRouteInput> = {}): EnglishRouteInput {
  return {
    message: "Ndofanira kudya chikafu chipi?",
    language: "shona",
    history: [],
    deadlineAt: 32_000,
    redFlagPattern: RED_FLAGS,
    redFlagNotice: NOTICE,
    redFlagInMessage: false,
    ...overrides,
  };
}

Deno.test("Shona: question goes to MedGemma in English and the answer comes back in Shona", async () => {
  const { calls, deps } = setup();
  const history = [{ user: "Is spotting normal?", model: "Light spotting can be normal." }];
  const result = await answerInEnglish(input({ history }), deps);

  assertEquals(calls.map((c) => c.kind), ["translate", "medgemma", "translate"]);
  assertEquals(calls[0], {
    kind: "translate",
    text: "Ndofanira kudya chikafu chipi?",
    from: "shona",
    to: "english",
    purpose: "question",
  });
  const medgemma = calls[1] as Extract<Call, { kind: "medgemma" }>;
  assertEquals(medgemma.question, "<english> Ndofanira kudya chikafu chipi?");
  assertEquals(medgemma.history, history);
  // No language hint is added to the question any more.
  assert(!medgemma.question.includes("reply in"));
  assertEquals(calls[2], {
    kind: "translate",
    text: "Eat beans, greens and eggs.",
    from: "english",
    to: "shona",
    purpose: "answer",
  });

  assertEquals(result.reply, "<shona> Eat beans, greens and eggs.");
  assertEquals(result.englishQuestion, "<english> Ndofanira kudya chikafu chipi?");
  assertEquals(result.englishAnswer, "Eat beans, greens and eggs.");
  assertEquals(result.questionTranslator, "fake");
  assertEquals(result.answerTranslator, "fake");
  assertEquals(result.redFlag, false);
});

Deno.test("English: no translation at all", async () => {
  const { calls, deps } = setup();
  const result = await answerInEnglish(
    input({ message: "What should I eat?", language: "english" }),
    deps,
  );
  assertEquals(calls.map((c) => c.kind), ["medgemma"]);
  assertEquals(result.reply, "Eat beans, greens and eggs.");
  assertEquals(result.questionTranslator, "none");
  assertEquals(result.answerTranslator, "none");
});

Deno.test("a red flag found in the English translation is translated back with the answer", async () => {
  const { calls, deps } = setup({
    translate: (text, from, to, options) => {
      calls.push({ kind: "translate", text, from, to, purpose: options.purpose });
      const out = to === "english" ? "I have heavy bleeding" : `<${to}> ${text}`;
      return Promise.resolve({ text: out, source: "fake" });
    },
  });
  const progress = { redFlag: false };
  const result = await answerInEnglish(input({ progress }), deps);

  assert(result.redFlag);
  assert(progress.redFlag);
  const back = calls[2] as Extract<Call, { kind: "translate" }>;
  assertEquals(back.text, NOTICE + "Eat beans, greens and eggs.");
  assertEquals(result.reply, `<shona> ${NOTICE}Eat beans, greens and eggs.`);
  // The stored English answer stays MedGemma's own words, without the notice.
  assertEquals(result.englishAnswer, "Eat beans, greens and eggs.");
});

Deno.test("a failed translation throws so the caller can fall back", async () => {
  const { deps } = setup({
    translate: () => Promise.reject(new Error("all translators down")),
  });
  await assertRejects(() => answerInEnglish(input(), deps), Error, "all translators down");
});

Deno.test("MedGemma's budget keeps time for translating the answer back", async () => {
  const { calls, deps } = setup();
  await answerInEnglish(input({ deadlineAt: 32_000 }), deps);
  const medgemma = calls[1] as Extract<Call, { kind: "medgemma" }>;
  // 32s deadline, 0.5s spent translating the question, 8s kept for the answer.
  assertEquals(medgemma.timeoutMs, 32_000 - 500 - 8_000);
});

Deno.test("throws instead of calling MedGemma when too little time is left", async () => {
  const { calls, deps } = setup();
  await assertRejects(
    () => answerInEnglish(input({ deadlineAt: 12_000 }), deps),
    Error,
    "No time left for MedGemma",
  );
  assertEquals(calls.map((c) => c.kind), ["translate"]);
});

Deno.test("an empty MedGemma reply throws", async () => {
  const { deps } = setup({
    askMedGemma: () => Promise.resolve({ text: "  ", raw: {} }),
  });
  await assertRejects(() => answerInEnglish(input(), deps), Error, "empty reply");
});

// --- History ----------------------------------------------------------------

function user(content: string, language: string): HistoryTurnLike {
  return { role: "user", content, payload: { metadata: { language } } };
}
function assistant(
  content: string,
  payload: Record<string, unknown>,
  source = "rudo_medgemma",
): HistoryTurnLike {
  return { role: "assistant", content, source, payload };
}

Deno.test("history uses the stored English copies whatever language the patient used", () => {
  const history = [
    user("Ndine nhumbu", "shona"),
    assistant("Makorokoto!", {
      reply_language: "shona",
      english_question: "I am pregnant",
      english_answer: "Congratulations!",
    }),
  ];
  assertEquals(toEnglishHistory(history), [{ user: "I am pregnant", model: "Congratulations!" }]);
});

Deno.test("older rows: English pairs are kept, other languages without copies are dropped", () => {
  const history = [
    user("Is spotting normal?", "english"),
    assistant("Light spotting can be normal.", { reply_language: "english" }),
    user("Ndine nhumbu", "shona"),
    assistant("Makorokoto!", { reply_language: "shona" }),
  ];
  assertEquals(toEnglishHistory(history), [
    { user: "Is spotting normal?", model: "Light spotting can be normal." },
  ]);
});

Deno.test("booking and company replies are left out, and only the last two pairs are kept", () => {
  const pair = (n: number) => [
    user(`q${n}`, "english"),
    assistant(`a${n}`, { reply_language: "english" }),
  ];
  const history = [
    ...pair(1),
    user("book me", "english"),
    assistant("Booked", { reply_language: "english" }, "rudo_booking"),
    ...pair(2),
    user("price?", "english"),
    assistant("K50", { reply_language: "english", route: "company" }),
    ...pair(3),
  ];
  assertEquals(toEnglishHistory(history), [
    { user: "q2", model: "a2" },
    { user: "q3", model: "a3" },
  ]);
});
