export interface EmbeddingProvider {
  /** Model identifier stored alongside vectors so stale embeddings can be detected. */
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const BATCH_SIZE = 64;

/** OpenAI-compatible embeddings client. Base URL configurable (OPENAI_BASE_URL) so any
 * compatible gateway works. Note: OpenRouter does NOT serve embeddings — use OpenAI direct
 * or another embedding-capable endpoint for this piece; OpenRouter is used for chat (Task 44). */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model = EMBEDDING_MODEL;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.slice(i, i + BATCH_SIZE) }),
      });
      if (!res.ok) {
        throw new Error(`embedding provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      out.push(...data.data.map((d) => d.embedding));
    }
    return out;
  }
}

/** Returns the configured provider, or null when no API key is set (embedding stage skipped). */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const key = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  return key ? new OpenAICompatibleEmbeddingProvider(key, baseUrl) : null;
}
