import { z } from "zod";

export const chatStreamSchema = z.object({
  /** Website public key (exposed on merchant sites). Resolves the merchant scope server-side. */
  siteKey: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  /** Existing conversation. If provided it MUST belong to the merchant resolved from siteKey. */
  conversationId: z.string().min(1).max(120).optional(),
  /** Anonymous buyer session id (from the SDK). */
  sessionId: z.string().min(1).max(160).optional(),
  customerId: z.string().min(1).max(120).optional(),
});

export type ChatStreamInput = z.infer<typeof chatStreamSchema>;

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; code: string; message: string };
