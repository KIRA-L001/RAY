import { Inject, Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { AppException } from "../../common/errors/app.exception";
import { ConversationsService } from "../conversations/conversations.service";
import { ShoppingAgentService, type AgentMessage, type ToolContext } from "./shopping-agent.service";
import type { ChatStreamEvent, ChatStreamInput } from "./ai-buyer.dto";

// tsx/esbuild does not emit decorator metadata, so all injected deps use explicit @Inject.

@Injectable()
export class AiBuyerService {
  private readonly db = getDb();

  // tsx/esbuild does not emit decorator metadata, so injected deps use explicit @Inject.
  constructor(
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(ShoppingAgentService) private readonly agent: ShoppingAgentService,
  ) {}

  /**
   * Resolve the merchant scope from the (client-safe) public site key, enforce
   * conversation tenant isolation, persist the user turn, and load history.
   * Any auth/tenant error here returns a normal HTTP error before streaming starts.
   */
  async prepare(input: ChatStreamInput): Promise<{
    conversationId: string;
    messages: AgentMessage[];
    ctx: ToolContext;
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
    const messages: AgentMessage[] = history.map((m) => ({
      role: m.role.toLowerCase() as AgentMessage["role"],
      content: m.content,
    }));
    return { conversationId, messages, ctx: { merchantId, customerId: input.customerId, sessionId: input.sessionId } };
  }

  /** Run the shopping agent and stream the final answer as NDJSON events; persist the assistant message. */
  async *streamReply(
    conversationId: string,
    messages: AgentMessage[],
    ctx: ToolContext,
  ): AsyncGenerator<ChatStreamEvent> {
    let assistantText = "";
    for await (const delta of this.agent.run(messages, ctx)) {
      assistantText += delta;
      yield { type: "delta", text: delta };
    }
    await this.conversations.appendMessage(conversationId, "ASSISTANT", assistantText);
    yield { type: "done", conversationId };
  }
}
