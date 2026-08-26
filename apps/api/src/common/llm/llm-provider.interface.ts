/** Minimal LLM provider interface (Task 44 will add real implementations). */
export interface LLMProvider {
  /** Stream chat completions as a sequence of text deltas. */
  streamChat(params: {
    messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): AsyncIterable<string>;
}

export const LLM_PROVIDER = Symbol("LLM_PROVIDER");

// ponytail: no real provider is implemented yet (Task 44). This mock is the
// minimum stub that lets the streaming transport be exercised end-to-end; it
// streams deterministic text and must be replaced by OpenAI/Anthropic/Gemini
// providers before any production traffic.
export class MockLLMProvider implements LLMProvider {
  async *streamChat(params: {
    messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): AsyncIterable<string> {
    const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
    const text =
      `Hi, I'm RAY — your shopping assistant. ` +
      `You asked: "${lastUser?.content ?? ""}". ` +
      `(Mock LLM response; wire a real provider in Task 44.)`;
    for (const token of text.split(/(\s+)/)) {
      if (token.length === 0) continue;
      yield token;
    }
  }
}