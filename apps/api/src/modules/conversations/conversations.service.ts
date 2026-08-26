import { Injectable } from "@nestjs/common";
import { getDb, type Json } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

export interface CreateConversationInput {
  merchantId: string;
  sessionId?: string;
  customerId?: string;
  channel?: string;
}

@Injectable()
export class ConversationsService {
  private readonly db = getDb();

  async create(input: CreateConversationInput) {
    const conversation = await this.db.conversation.create({
      data: {
        id: newId("conv"),
        merchantId: input.merchantId,
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel ?? "WEB",
      },
    });
    return { id: conversation.id, createdAt: conversation.createdAt };
  }

  /** Tenant guard: conversation must belong to the resolved merchant. */
  async getForMerchant(merchantId: string, conversationId: string) {
    const conversation = await this.db.conversation.findFirst({
      where: { id: conversationId, merchantId },
    });
    if (!conversation) {
      throw new AppException(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    return conversation;
  }

  /** Attach a resolved customer to a conversation so later carts/orders attribute correctly. */
  async linkCustomer(conversationId: string, customerId: string) {
    await this.db.conversation.update({ where: { id: conversationId }, data: { customerId } });
  }

  async appendMessage(
    conversationId: string,
    role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL",
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    const message = await this.db.conversationMessage.create({
      data: {
        id: newId("msg"),
        conversationId,
        role,
        content,
        ...(metadata ? { metadata: metadata as unknown as Json } : {}),
      },
    });
    return { id: message.id, role: message.role, content: message.content };
  }

  async history(conversationId: string) {
    const messages = await this.db.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return messages;
  }
}
