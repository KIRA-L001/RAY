import { Inject, Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { AppException } from "../../common/errors/app.exception";
import { LLM_PROVIDER, type LLMProvider } from "../../common/llm/llm-provider.interface";
import { ConversationsService } from "../conversations/conversations.service";
import type { ChatStreamEvent, ChatStreamInput } from "./ai-buyer.dto";

// tsx/esbuild does not emit decorator metadata, so all injected deps use explicit @Inject.

const SYSTEM_PROMPT =
  "You are RAY, a shopping assistant for an online store. Help the customer " +
  "discover products and refine their request. Never invent orders, prices, or " +
  "payments. Be concise.";

@Injectable()
export class AiBuyerService {
  private readonly db = getDb();

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
  ) {}

  /**
   * Resolve the merchant scope from the (client-safe) public site key, enforce
   * conversation tenant isolation, persist the user turn, and build the LLM prompt.
   * Any auth/tenant error here returns a normal HTTP error before streaming starts.
   */
  async prepare(input: ChatStreamInput): Promise<{
    conversationId: string;
    messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
  }> {
    // Tenant boundary: merchantId is derived server-side, never trusted from the client.
    const website = await this.db.website.findUnique({
      where: { publicKey: input.siteKey },
      select: { id: true, merchantId: true, status: true },
    });
    if (!website) {
      throw new AppException(404, "SITE_NOT_FOUND", "Site not found");
    }
    if (website.status !== "READY") {
      throw new AppException(403, "SITE_NOT_READY", "Site is not ready for chat");
    }
    const merchantId = website.merchantId;

    // conversationId is validated to belong to this merchant (tenant isolation).
    const conversationId = input.conversationId
      ? (await this.conversations.getForMerchant(merchantId, input.conversationId)).id
      : (
          await this.conversations.create({
            merchantId,
            sessionId: input.sessionId,
            customerId: input.customerId,
            channel: "BUYER",
          })
        ).id;

    await this.conversations.appendMessage(conversationId, "USER", input.message);

    const history = await this.conversations.history(conversationId);
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role.toLowerCase() as "user" | "assistant" | "system", content: m.content })),
    ];
    return { conversationId, messages };
  }

  /** Stream the assistant reply as NDJSON events and persist the final message. */
  async *streamReply(
    conversationId: string,
    messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>,
  ): AsyncGenerator<ChatStreamEvent> {
    let assistantText = "";
    for await (const delta of this.llm.streamChat({ messages })) {
      assistantText += delta;
      yield { type: "delta", text: delta };
    }
    await this.conversations.appendMessage(conversationId, "ASSISTANT", assistantText);
    yield { type: "done", conversationId };
  }
}
