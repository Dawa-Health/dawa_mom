// supabase/functions/_shared/language_providers/index.ts
//
// The list of plugins that ship with the project. To add a provider, create a file in
// this folder that exports a LanguageProvider and add it to the array below. To remove
// one (for example Gemini), delete its import and its entry. The detector in
// ../language.ts does not need to change.

import type { LanguageProvider } from "../language_types.ts";
import { geminiProvider } from "./gemini.ts";
import { keywordProvider } from "./keywords.ts";
import { openAiCompatibleProvider } from "./openai_compatible.ts";

export const BUILT_IN_PROVIDERS: LanguageProvider[] = [
  geminiProvider,
  openAiCompatibleProvider,
  keywordProvider,
];