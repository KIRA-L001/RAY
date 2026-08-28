import { randomUUID } from "node:crypto";
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";
import { z } from "zod";
import { enqueueNotification } from "./notification.queue";

const sendSchema = z.object({
  to: z.string().min(5).max(20),
  body: z.string().min(1).max(4096),
  channelType: z.string().optional(),
  purpose: z.string().optional(),
  customerId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

// ponytail: minimal trigger — a merchant-scoped endpoint that queues a
// notification. Real product events (order placed, etc.) can call
// enqueueNotification directly instead of this manual endpoint later.
@Controller("v1/merchants/:merchantId")
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class NotificationsController {
  @Post("notifications")
  @RequireMerchantRole("MANAGER")
  async send(
    @Param("merchantId") merchantId: string,
    @Body(new ZodValidationPipe(sendSchema)) body: z.infer<typeof sendSchema>,
  ): Promise<{ ok: boolean; idempotencyKey: string }> {
    const idempotencyKey = body.idempotencyKey ?? randomUUID();
    await enqueueNotification({
      idempotencyKey,
      merchantId,
      channelType: body.channelType ?? "WHATSAPP",
      to: body.to,
      body: body.body,
      purpose: body.purpose ?? "notification",
      customerId: body.customerId,
    });
    return { ok: true, idempotencyKey };
  }
}
