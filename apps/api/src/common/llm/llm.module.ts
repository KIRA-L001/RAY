import { Module } from "@nestjs/common";
import { LLM_PROVIDER } from "./llm-provider.interface";
import { createLlmProvider, llmConfigFromEnv } from "./llm-providers";

@Module({
  providers: [{ provide: LLM_PROVIDER, useFactory: () => createLlmProvider(llmConfigFromEnv()) }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
