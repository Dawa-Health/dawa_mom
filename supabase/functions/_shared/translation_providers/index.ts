// supabase/functions/_shared/translation_providers/index.ts
//
// The translation plugins that ship with the project. To add one, create a file in this
// folder that exports a TranslationProvider and add it below. Which ones run, and in
// what order, is set with RUDO_TRANSLATION_PROVIDERS (default: mansa,gemini).

import type { TranslationProvider } from "../translation_types.ts";
import { geminiTranslationProvider } from "./gemini.ts";
import { mansaTranslationProvider } from "./mansa.ts";
import { openAiCompatibleTranslationProvider } from "./openai_compatible.ts";

export const BUILT_IN_TRANSLATION_PROVIDERS: TranslationProvider[] = [
  mansaTranslationProvider,
  geminiTranslationProvider,
  openAiCompatibleTranslationProvider,
];
