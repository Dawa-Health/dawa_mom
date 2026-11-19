export async function callFunction(
  name: string,
  body: unknown,
  authorization?: string,
): Promise<Record<string, any>> {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error(`${name}: SUPABASE_URL not set`);
  if (!authorization) throw new Error(`${name}: missing caller authorization`);

  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${name}: ${res.status} ${json?.error ?? "upstream error"}`);
  return json;
}

// Cut at a sentence boundary under `max` so fallback providers don't reject long replies.
export function clipText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return { text: end > max / 2 ? cut.slice(0, end + 1) : cut, truncated: true };
}