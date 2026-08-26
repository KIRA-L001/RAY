import { Module } from "@nestjs/common";
import { LLM_PROVIDER, MockLLMProvider } from "./llm-provider.interface";

@Module({
  providers: [{ provide: LLM_PROVIDER, useClass: MockLLMProvider }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
