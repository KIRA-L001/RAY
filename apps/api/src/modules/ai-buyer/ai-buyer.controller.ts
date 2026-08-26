import { Body, Controller, Header, HttpCode, Inject, Post } from "@nestjs/common";
import { Readable } from "node:stream";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AiBuyerService } from "./ai-buyer.service";
import { chatStreamSchema, type ChatStreamInput } from "./ai-buyer.dto";

@Controller("v1/buyer/chat")
export class AiBuyerController {
  // tsx/esbuild does not emit decorator metadata, so injected deps use explicit @Inject.
  constructor(@Inject(AiBuyerService) private readonly service: AiBuyerService) {}

  @Post("stream")
  @HttpCode(200)
  @Header("content-type", "application/x-ndjson; charset=utf-8")
  @Header("cache-control", "no-store")
  @Header("x-accel-buffering", "no")
  async stream(@Body(new ZodValidationPipe(chatStreamSchema)) body: ChatStreamInput): Promise<Readable> {
    // Tenant/auth errors surface as normal HTTP errors before we start streaming.
    const { conversationId, messages } = await this.service.prepare(body);

    const service = this.service;
    return Readable.from(
      (async function* () {
        for await (const event of service.streamReply(conversationId, messages)) {
          yield JSON.stringify(event) + "\n";
        }
      })(),
    );
  }
}
