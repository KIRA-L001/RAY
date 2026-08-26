import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getDb, type Json } from "@ray/database";

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

  /** Record one tool invocation for an agent run (Task 72: tool framework trace). */
  async logToolCall(params: {
    agentRunId: string;
    toolName: string;
    args: unknown;
    result: string;
    status: "SUCCESS" | "ERROR";
    durationMs: number;
    errorCode?: string | null;
  }): Promise<void> {
    await this.db.agentToolCall.create({
      data: {
        id: randomUUID(),
        agentRunId: params.agentRunId,
        toolName: params.toolName,
        input: params.args as Json,
        output: params.result,
        status: params.status,
        durationMs: params.durationMs,
        errorCode: params.errorCode ?? null,
      },
    });
  }
}
