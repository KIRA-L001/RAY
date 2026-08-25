export interface EmbeddingProvider {
  /** Model identifier stored alongside vectors so stale embeddings can be detected. */
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 64;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model = EMBEDDING_MODEL;

  constructor(private readonly apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
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
  return key ? new OpenAIEmbeddingProvider(key) : null;
}
