const ALIASES: Record<string, string> = {
  en: "english", sn: "shona", nd: "ndebele", nde: "ndebele",
  bem: "bemba", ny: "chinyanja", nya: "chinyanja",
  nyanja: "chinyanja", chichewa: "chinyanja",
};

export function normalizeLang(raw?: string | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().split(/[-_]/)[0];
  return key ? (ALIASES[key] ?? key) : null;
}