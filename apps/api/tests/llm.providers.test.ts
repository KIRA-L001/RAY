import assert from "node:assert/strict";
import { test } from "node:test";
import { createLlmProvider, type LlmConfig } from "../src/common/llm/llm-providers";
import { MockLLMProvider } from "../src/common/llm/llm-provider.interface";

const msgs = [{ role: "user" as const, content: "hi" }];

test("factory selects mock by default and for unknown provider", () => {
  assert.ok(createLlmProvider({ provider: "mock" }) instanceof MockLLMProvider);
  assert.ok(createLlmProvider({ provider: "bogus" as LlmConfig["provider"] }) instanceof MockLLMProvider);
});

test("factory selects the real provider when its key is present", () => {
  assert.equal(createLlmProvider({ provider: "openai", openaiApiKey: "k" }).constructor.name, "OpenAIProvider");
  assert.equal(createLlmProvider({ provider: "anthropic", anthropicApiKey: "k" }).constructor.name, "AnthropicProvider");
  assert.equal(createLlmProvider({ provider: "gemini", geminiApiKey: "k" }).constructor.name, "GeminiProvider");
});

test("factory fails fast when a provider is selected without its key", () => {
  assert.throws(() => createLlmProvider({ provider: "openai" }), /OPENAI_API_KEY/);
  assert.throws(() => createLlmProvider({ provider: "anthropic" }), /ANTHROPIC_API_KEY/);
  assert.throws(() => createLlmProvider({ provider: "gemini" }), /GEMINI_API_KEY/);
});

async function collect(provider: { streamChat(p: { messages: typeof msgs }): AsyncIterable<string> }): Promise<string> {
  let out = "";
  for await (const delta of provider.streamChat({ messages: msgs })) out += delta;
  return out;
}

function withFakeFetch(sse: string, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("OpenAIProvider parses streaming deltas", async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
    "data: [DONE]\n\n";
  await withFakeFetch(sse, async () => {
    const text = await collect(createLlmProvider({ provider: "openai", openaiApiKey: "k" }));
    assert.equal(text, "Hello world");
  });
});

test("AnthropicProvider parses content_block_delta events", async () => {
  const sse =
    'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
    'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":" there"}}\n\n' +
    "event: message_stop\ndata: {}\n\n";
  await withFakeFetch(sse, async () => {
    const text = await collect(createLlmProvider({ provider: "anthropic", anthropicApiKey: "k" }));
    assert.equal(text, "Hi there");
  });
});

test("GeminiProvider parses streamed candidate parts", async () => {
  const sse =
    'data: {"candidates":[{"content":{"parts":[{"text":"Hey"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"parts":[{"text":" you"}]}}]}\n\n';
  await withFakeFetch(sse, async () => {
    const text = await collect(createLlmProvider({ provider: "gemini", geminiApiKey: "k" }));
    assert.equal(text, "Hey you");
  });
});
