// supabase/functions/_shared/medgemma.ts
//
// Calls the MedGemma Gradio Space endpoint `/answer`, whose inputs are, in order:
//   [question, history_json, max_new_tokens, token]
//
// Required Supabase secrets:
//   MEDGEMMA_SPACE_URL  e.g. https://tarirozw-medgemma-maternal.hf.space   (no trailing slash needed)
//   MEDGEMMA_TOKEN      must equal the Space's MEDGEMMA_TOKEN secret
// Optional:
//   HF_TOKEN            only needed if the Space is private

export type MedGemmaTurn = { user: string; model: string };

type AskInput = {
  question: string;
  history?: MedGemmaTurn[];
  maxNewTokens?: number;
};

const REQUEST_TIMEOUT_MS = 70_000; // ZeroGPU cold starts can be slow

// Public entry point. A `null` error from the Space means its handler crashed with an
// unhandled exception, which on ZeroGPU is often transient (GPU contention, cold worker),
// so retry once. The caller's overall timeout and Gemini fallback still apply.
export async function askMedGemma(
  input: AskInput,
): Promise<{ text: string; raw: Record<string, unknown> }> {
  try {
    return await askOnce(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MedGemma Space error: null")) {
      const retry = await askOnce(input);
      return { text: retry.text, raw: { ...retry.raw, retried: true } };
    }
    throw error;
  }
}

async function askOnce(
  input: AskInput,
): Promise<{ text: string; raw: Record<string, unknown> }> {
  const base = (Deno.env.get("MEDGEMMA_SPACE_URL") ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("MEDGEMMA_SPACE_URL is not configured");

  const token = Deno.env.get("MEDGEMMA_TOKEN") ?? "";
  const hfToken = Deno.env.get("HF_TOKEN");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const data = [
    input.question.trim().slice(0, 1500), // question
    JSON.stringify(input.history ?? []), // history_json
    input.maxNewTokens ?? 350, // max_new_tokens (Space caps at 400)
    token, // token
  ];

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  // Step 1: submit the job (Gradio 5 call API).
  const submit = await fetch(`${base}/gradio_api/call/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
    signal,
  });
  if (!submit.ok) {
    const body = (await submit.text().catch(() => "")).slice(0, 300);
    throw new Error(`MedGemma Space submit returned ${submit.status}: ${body}`);
  }
  const { event_id } = await submit.json() as { event_id?: string };
  if (!event_id) throw new Error("MedGemma Space did not return an event_id");

  // Step 2: read the SSE stream until `complete` or `error`.
  const result = await fetch(`${base}/gradio_api/call/answer/${event_id}`, {
    headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : {},
    signal,
  });
  if (!result.ok) {
    throw new Error(`MedGemma Space result returned ${result.status}`);
  }

  const sse = await result.text();
  const text = parseSse(sse);
  return { text, raw: { event_id } };
}

function parseSse(body: string): string {
  let lastEvent = "";
  let lastData = "";

  for (const block of body.split(/\n\n+/)) {
    let event = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (event === "complete" || event === "error") {
      lastEvent = event;
      lastData = dataLines.join("\n");
    }
  }

  if (lastEvent === "error") {
    // gr.Error(...) messages arrive here as a JSON string; a crash arrives as `null`.
    throw new Error(`MedGemma Space error: ${lastData}`);
  }
  if (lastEvent !== "complete") {
    throw new Error(`MedGemma Space stream ended without a result: ${body.slice(0, 200)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastData);
  } catch {
    throw new Error("MedGemma Space returned unparseable data");
  }
  const text = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("MedGemma Space returned an empty reply");
  }
  return text.trim();
}