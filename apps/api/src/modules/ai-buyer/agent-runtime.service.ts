import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getDb } from "@ray/database";

export interface AgentRunContext {
  merchantId: string;
  conversationId?: string | null;
  sessionId?: string | null;
}

@Injectable()
export class AgentRuntimeService {
  private readonly db = getDb();

  /** Open an agent_run row and return its id so tool calls can be linked (Task 72). */
  async start(agentType: string, ctx: AgentRunContext): Promise<string> {
    const id = randomUUID();
    await this.db.agentRun.create({
      data: {
        id,
        merchantId: ctx.merchantId,
        agentType,
        conversationId: ctx.conversationId ?? null,
        sessionId: ctx.sessionId ?? null,
        status: "RUNNING",
      },
    });
    return id;
  }

  async finish(id: string, status: "SUCCEEDED" | "FAILED", tokens?: { promptTokens?: number; completionTokens?: number }): Promise<void> {
    await this.db.agentRun.update({
      where: { id },
      data: {
        status,
        completedAt: new Date(),
        promptTokens: tokens?.promptTokens ?? null,
        completionTokens: tokens?.completionTokens ?? null,
      },
    });
  }
}
