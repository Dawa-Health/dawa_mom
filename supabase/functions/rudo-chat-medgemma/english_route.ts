// supabase/functions/rudo-chat-medgemma/english_route.ts
//
// MedGemma only ever reads and writes English. For any other language:
//
//   patient's message --translate--> English --MedGemma--> English answer --translate--> patient
//
// Speech stays with Mansa: the app transcribes the voice note with Mansa before this
// runs, and speaks the translated reply with Mansa TTS afterwards.
//
// Any failure (translation or MedGemma) throws, so the caller can fall back to Gemini.

import { normalizeLanguage, type RudoLanguage } from "../_shared/language.ts";
import type { MedGemmaTurn } from "../_shared/medgemma.ts";
import {
  type TranslateResult,
  translateText,
  translationTimeoutFromEnv,
} from "../_shared/translate.ts";

// Time kept free after MedGemma answers so its reply can still be translated back.
export const ANSWER_TRANSLATION_RESERVE_MS = 8_000;
// Below this, MedGemma is not worth calling (ZeroGPU replies take several seconds).
export const MIN_MEDGEMMA_BUDGET_MS = 5_000;
// The shortest timeout any translation call gets, however close the deadline is.
const MIN_TRANSLATION_TIMEOUT_MS = 2_000;
// How many earlier English exchanges MedGemma sees (the Space keeps 2 as well).
const HISTORY_PAIRS = 2;

export type HistoryTurnLike = {
  role: string;
  content: string;
  source?: string | null;
  payload?: Record<string, unknown> | null;
};

export type EnglishRouteInput = {
  message: string;
  language: RudoLanguage;
  history: MedGemmaTurn[]; // already English, see toEnglishHistory
  // When the English route must be finished (the caller keeps its own fallback time).
  deadlineAt: number;
  redFlagPattern: RegExp; // English patterns, checked against the English question
  redFlagNotice: string; // English, translated together with the answer
  redFlagInMessage: boolean; // the original message already matched
  // Filled in as the route goes, so a caller that falls back after a later failure
  // still knows about a red flag found in the translated question.
  progress?: { redFlag: boolean };
};

export type EnglishRouteResult = {
  reply: string; // in the patient's language, red-flag notice included
  englishQuestion: string;
  englishAnswer: string; // MedGemma's own words, without the notice
  redFlag: boolean;
  questionTranslator: string; // provider name, or "none" for English
  answerTranslator: string;
  medgemmaRaw: Record<string, unknown>;
};

export type EnglishRouteDeps = {
  translate: (
    text: string,
    from: RudoLanguage,
    to: RudoLanguage,
    options: { purpose: "question" | "answer"; timeoutMs: number },
  ) => Promise<TranslateResult>;
  askMedGemma: (
    input: { question: string; history: MedGemmaTurn[] },
    timeoutMs: number,
  ) => Promise<{ text: string; raw: Record<string, unknown> }>;
  now: () => number;
  log: (event: string, data?: Record<string, unknown>) => void;
  translationTimeoutMs?: number;
};

export const defaultTranslate: EnglishRouteDeps["translate"] = (text, from, to, options) =>
  translateText(text, from, to, options);

export async function answerInEnglish(
  input: EnglishRouteInput,
  deps: EnglishRouteDeps,
): Promise<EnglishRouteResult> {
  const isEnglish = input.language === "english";
  const maxTranslationMs = deps.translationTimeoutMs ?? translationTimeoutFromEnv();
  const translationTimeout = (reserveMs: number) =>
    Math.max(
      MIN_TRANSLATION_TIMEOUT_MS,
      Math.min(maxTranslationMs, input.deadlineAt - deps.now() - reserveMs),
    );

  // 1. The patient's message, in English.
  let englishQuestion = input.message.trim();
  let questionTranslator = "none";
  if (!isEnglish) {
    const t0 = deps.now();
    // Leave room for MedGemma and the answer's translation after this call.
    const question = await deps.translate(englishQuestion, input.language, "english", {
      purpose: "question",
      timeoutMs: translationTimeout(MIN_MEDGEMMA_BUDGET_MS + ANSWER_TRANSLATION_RESERVE_MS),
    });
    englishQuestion = question.text;
    questionTranslator = question.source;
    deps.log("question_translated", {
      from: input.language,
      provider: question.source,
      ms: deps.now() - t0,
      length: englishQuestion.length,
      skipped: question.errors,
    });
  }

  // 2. Red flags. The patterns are English, so this is the first time a non-English
  //    message can be checked properly.
  const redFlagInTranslation = !isEnglish && input.redFlagPattern.test(englishQuestion);
  const redFlag = input.redFlagInMessage || redFlagInTranslation;
  if (input.progress) input.progress.redFlag = redFlag;
  if (redFlagInTranslation && !input.redFlagInMessage) {
    deps.log("red_flag_detected_in_translation", { language: input.language });
  }

  // 3. MedGemma, in English, with English history and no language hint.
  const budgetMs = input.deadlineAt - deps.now() -
    (isEnglish ? 0 : ANSWER_TRANSLATION_RESERVE_MS);
  if (budgetMs < MIN_MEDGEMMA_BUDGET_MS) {
    throw new Error(`No time left for MedGemma (${budgetMs}ms)`);
  }
  deps.log("medgemma_call_start", {
    budgetMs,
    historyPairs: input.history.length,
    language: input.language,
  });
  const t1 = deps.now();
  const answer = await deps.askMedGemma(
    { question: englishQuestion, history: input.history },
    budgetMs,
  );
  const englishAnswer = answer.text.trim();
  if (!englishAnswer) throw new Error("MedGemma returned an empty reply");
  deps.log("medgemma_call_ok", { ms: deps.now() - t1, replyLength: englishAnswer.length });

  // 4. Back to the patient's language. The red-flag notice is translated with the
  //    answer so the warning reaches the patient in her own language.
  const englishReply = (redFlag ? input.redFlagNotice : "") + englishAnswer;
  let reply = englishReply;
  let answerTranslator = "none";
  if (!isEnglish) {
    const t2 = deps.now();
    const translated = await deps.translate(englishReply, "english", input.language, {
      purpose: "answer",
      timeoutMs: translationTimeout(0),
    });
    reply = translated.text;
    answerTranslator = translated.source;
    deps.log("answer_translated", {
      to: input.language,
      provider: translated.source,
      ms: deps.now() - t2,
      length: reply.length,
      skipped: translated.errors,
    });
  }

  return {
    reply,
    englishQuestion,
    englishAnswer,
    redFlag,
    questionTranslator,
    answerTranslator,
    medgemmaRaw: answer.raw,
  };
}

// Earlier medical exchanges, in English, as {user, model} pairs for MedGemma.
//  - Replies made through the English route carry English copies in their payload
//    (english_question / english_answer), whatever language the patient used.
//  - Older replies have no copies; they are kept only if both sides were English.
//  - Booking and company/price replies are dropped so they don't steer the medical model.
export function toEnglishHistory(history: HistoryTurnLike[]): MedGemmaTurn[] {
  const pairs: MedGemmaTurn[] = [];
  let pendingUser: { text: string; language: RudoLanguage | null } | null = null;
  for (const turn of history) {
    if (turn.role === "user") {
      const meta = turn.payload?.metadata as Record<string, unknown> | undefined;
      pendingUser = {
        text: turn.content,
        language: normalizeLanguage(typeof meta?.language === "string" ? meta.language : null),
      };
      continue;
    }
    if (turn.role !== "assistant" || pendingUser === null) continue;

    const payload = turn.payload ?? {};
    const isBooking = turn.source === "rudo_booking";
    const isCompany = payload.route === "company";
    if (!isBooking && !isCompany) {
      const englishQuestion = payload.english_question;
      const englishAnswer = payload.english_answer;
      if (typeof englishQuestion === "string" && typeof englishAnswer === "string") {
        pairs.push({ user: englishQuestion, model: englishAnswer });
      } else {
        const replyLanguage = normalizeLanguage(
          typeof payload.reply_language === "string" ? payload.reply_language : null,
        );
        if (pendingUser.language === "english" && replyLanguage === "english") {
          pairs.push({ user: pendingUser.text, model: turn.content });
        }
      }
    }
    pendingUser = null;
  }
  return pairs.slice(-HISTORY_PAIRS);
}
