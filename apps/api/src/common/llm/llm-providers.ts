import type { LLMProvider } from "./llm-provider.interface";
import { MockLLMProvider } from "./llm-provider.interface";
import { assertPublicUrl } from "../security/ssrf";

export type LlmProviderName = "openai" | "anthropic" | "gemini" | "mock";

export interface LlmConfig {
  provider: LlmProviderName;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  baseUrl?: { openai?: string; anthropic?: string; gemini?: string };
}

type ChatParams = {
  messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

const DEFAULT_MODELS: Record<Exclude<LlmProviderName, "mock">, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-1.5-flash",
};

// ponytail: native fetch + SSE over adding openai/anthropic/google SDKs. One small
// SSE reader serves all three providers (different event shapes handled per provider).
interface SseBlock {
  event?: string;
  data: string;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pick(obj: unknown, ...keys: Array<string | number>): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in (cur as Record<PropertyKey, unknown>)) {
      cur = (cur as Record<PropertyKey, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

async function* sseBlocks(res: Response): AsyncGenerator<SseBlock> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const take = (): string | null => {
    const i = buffer.indexOf("\n\n");
    if (i === -1) return null;
    const block = buffer.slice(0, i);
    buffer = buffer.slice(i + 2);
    return block;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let block: string | null;
      while ((block = take())) {
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const last = parseBlock(buffer);
      if (last) yield last;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(raw: string): SseBlock | null {
  let event: string | undefined;
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data: data.trim() };
}

async function* streamFrom(
  res: Response,
  extract: (json: unknown) => string | undefined,
  stop: (block: SseBlock) => boolean,
): AsyncGenerator<string> {
  if (!res.ok) {
    throw new Error(`llm provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  for await (const block of sseBlocks(res)) {
    if (stop(block)) break;
    const text = extract(safeJson(block.data));
    if (text) yield text;
  }
}

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly cfg: LlmConfig) {}

  async *streamChat(p: ChatParams): AsyncIterable<string> {
    const model = p.model ?? this.cfg.model ?? DEFAULT_MODELS.openai;
    const url = `${this.cfg.baseUrl?.openai ?? "https://api.openai.com/v1"}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.openaiApiKey ?? ""}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
      body: JSON.stringify({
        model,
        stream: true,
        temperature: p.temperature ?? this.cfg.temperature,
        max_tokens: p.maxTokens ?? this.cfg.maxTokens,
        messages: p.messages,
      }),
    });
    yield* streamFrom(
      res,
      (json) => pick(json, "choices", 0, "delta", "content") as string | undefined,
      (b) => b.data === "[DONE]",
    );
  }
}

export class AnthropicProvider implements LLMProvider {
  constructor(private readonly cfg: LlmConfig) {}

  async *streamChat(p: ChatParams): AsyncIterable<string> {
    const model = p.model ?? this.cfg.model ?? DEFAULT_MODELS.anthropic;
    const system = p.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const messages = p.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const url = `${this.cfg.baseUrl?.anthropic ?? "https://api.anthropic.com/v1"}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": this.cfg.anthropicApiKey ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
      body: JSON.stringify({
        model,
        max_tokens: p.maxTokens ?? this.cfg.maxTokens ?? 1024,
        stream: true,
        system: system || undefined,
        temperature: p.temperature ?? this.cfg.temperature,
        messages,
      }),
    });
    yield* streamFrom(
      res,
      (json) => pick(json, "delta", "text") as string | undefined,
      (b) => b.event === "message_stop",
    );
  }
}

export class GeminiProvider implements LLMProvider {
  constructor(private readonly cfg: LlmConfig) {}

  async *streamChat(p: ChatParams): AsyncIterable<string> {
    const model = p.model ?? this.cfg.model ?? DEFAULT_MODELS.gemini;
    const system = p.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = p.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const url = `${this.cfg.baseUrl?.gemini ?? "https://generativelanguage.googleapis.com/v1beta"}/models/${model}:streamGenerateContent?alt=sse&key=${this.cfg.geminiApiKey ?? ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: p.temperature ?? this.cfg.temperature,
          maxOutputTokens: p.maxTokens ?? this.cfg.maxTokens,
        },
      }),
    });
    yield* streamFrom(
      res,
      (json) => pick(json, "candidates", 0, "content", "parts", 0, "text") as string | undefined,
      () => false,
    );
  }
}

export function createLlmProvider(cfg: LlmConfig): LLMProvider {
  switch (cfg.provider) {
    case "openai":
      if (!cfg.openaiApiKey) throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY");
      return new OpenAIProvider(cfg);
    case "anthropic":
      if (!cfg.anthropicApiKey) throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
      return new AnthropicProvider(cfg);
    case "gemini":
      if (!cfg.geminiApiKey) throw new Error("LLM_PROVIDER=gemini requires GEMINI_API_KEY");
      return new GeminiProvider(cfg);
    case "mock":
    default:
      return new MockLLMProvider();
  }
}

function envNum(key: string): number | undefined {
  const v = process.env[key];
  return v === undefined ? undefined : Number(v);
}

export function llmConfigFromEnv(): LlmConfig {
  const provider = (process.env.LLM_PROVIDER?.toLowerCase() ?? "mock") as LlmConfig["provider"];
  const guardedBaseUrl = (v?: string): string | undefined => {
    if (!v) return undefined;
    assertPublicUrl(v);
    return v;
  };
  return {
    provider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    model: process.env.LLM_MODEL,
    temperature: envNum("LLM_TEMPERATURE"),
    maxTokens: envNum("LLM_MAX_TOKENS"),
    timeoutMs: envNum("LLM_TIMEOUT_MS") ?? 30_000,
    baseUrl: {
      openai: guardedBaseUrl(process.env.OPENAI_BASE_URL),
      anthropic: guardedBaseUrl(process.env.ANTHROPIC_BASE_URL),
      gemini: guardedBaseUrl(process.env.GEMINI_BASE_URL),
    },
  };
}
