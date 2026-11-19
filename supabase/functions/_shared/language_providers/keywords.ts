// supabase/functions/_shared/language_providers/keywords.ts
//
// Plugin: offline keyword scoring. No network, no keys, no vendor. It is a rough
// heuristic, useful as a last resort after a model provider fails, for example
// RUDO_LANGUAGE_PROVIDERS=gemini,keywords. It returns null unless one language
// clearly wins, so it never guesses on short or generic text.

import type { ClassifyContext, LanguageProvider, RudoLanguage } from "../language_types.ts";

const KEYWORDS: Record<Exclude<RudoLanguage, "english">, string[]> = {
  shona: ["mhoro", "mhoroi", "makadini", "zvakanaka", "ndatenda", "pamuviri", "chibereko",
    "ndinoda", "kwete", "hapana", "ndine", "ndiri", "sei", "vanhu", "muviri", "nhumbu", "kuti"],
  ndebele: ["sawubona", "salibonani", "unjani", "ngiyabonga", "isisu", "umntwana", "umhlaza",
    "angikwazi", "ngifuna", "abantu", "impela"],
  chinyanja: ["moni", "zikomo", "pepani", "ndapota", "matenda", "kansa", "dokotala", "magazi",
    "ndikufuna", "mimba", "bwanji", "ndimva"],
  lozi: ["ndalumba", "kuhula", "maviki", "mutango", "kacenu", "musimbi", "bulwazi", "cwale"],
  bemba: ["mwaiseni", "natotela", "twatotela", "mukwai", "ubushiku", "icisungu", "shani"],
  tonga: ["mubuzyo", "kapati", "mutumbu", "dokota", "buti", "makani", "buumi"],
};

const ENGLISH = [
  "what", "how", "when", "why", "where", "signs", "symptoms", "please", "thank", "help",
  "during", "pregnant", "my", "the", "is", "are", "can", "should",
];

export const keywordProvider: LanguageProvider = {
  name: "keywords",

  isConfigured() {
    return true;
  },

  classify(text: string, _ctx: ClassifyContext): Promise<RudoLanguage | null> {
    const words = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
    const scores = new Map<RudoLanguage, number>();

    for (const [language, list] of Object.entries(KEYWORDS)) {
      const hits = list.filter((word) => words.has(word)).length;
      if (hits) scores.set(language as RudoLanguage, hits);
    }
    const englishHits = ENGLISH.filter((word) => words.has(word)).length;
    if (englishHits) scores.set("english", englishHits);

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return Promise.resolve(null);
    // Needs a clear winner: ahead of the runner-up and at least two matching words.
    const [top, runnerUp] = ranked;
    if (top[1] < 2 || (runnerUp && top[1] === runnerUp[1])) return Promise.resolve(null);
    return Promise.resolve(top[0]);
  },
};