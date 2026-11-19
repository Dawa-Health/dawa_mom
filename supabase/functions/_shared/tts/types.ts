export interface TtsInput {
  text: string;
  lang: string;            // any alias; providers normalize via lang.ts
  voice?: string;
  authorization?: string;  // caller's "Bearer <jwt>", forwarded to wrapped functions
}

export interface TtsOutput {
  audio: Uint8Array;
  mime: string;
  durationSeconds?: number | null;
  truncated?: boolean;
}

export interface TtsProvider {
  name: string;
  supports(lang: string): boolean;
  synthesize(input: TtsInput): Promise<TtsOutput>;
}