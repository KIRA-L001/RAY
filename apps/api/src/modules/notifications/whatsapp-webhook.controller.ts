import { Controller, Get, Post, Param, Query, Headers, Req, Res } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { getDb, Json } from "@ray/database";
import { decryptJson } from "./crypto";
import { extractStatuses, verifyMetaSignature } from "./whatsapp-webhook";

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

// ponytail: webhook is keyed by channel id in the URL so Meta's single
// callback URL can route to the right merchant/channel config (appSecret,
// verifyToken). If multiple providers are added, branch on a provider segment.
@Controller("v1/webhooks/whatsapp")
export class WhatsAppWebhookController {
  @Get(":channelId")
  async verify(
    @Param("channelId") channelId: string,
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const channel = await getDb().notificationChannel.findUnique({
      where: { id: channelId },
      select: { encryptedConfig: true },
    });
    const cfg = channel ? decryptJson<{ verifyToken?: string }>(channel.encryptedConfig) : null;
    if (mode === "subscribe" && cfg?.verifyToken && token === cfg.verifyToken) {
      res.type("text/plain").send(challenge);
      return;
    }
    res.status(403).send("forbidden");
  }

  @Post(":channelId")
  async ingest(
    @Param("channelId") channelId: string,
    @Req() req: RawBodyRequest,
    @Headers("x-hub-signature-256") signature: string,
  ): Promise<{ ok: boolean; processed?: number; replayed?: number; error?: string }> {
    const channel = await getDb().notificationChannel.findUnique({
      where: { id: channelId },
      select: { merchantId: true, encryptedConfig: true },
    });
    if (!channel) return { ok: false, error: "channel_not_found" };

    const raw = req.rawBody;
    if (!raw || !signature) return { ok: false, error: "missing_signature" };

    const cfg = decryptJson<{ appSecret?: string }>(channel.encryptedConfig);
    if (!cfg.appSecret || !verifyMetaSignature(raw, cfg.appSecret, signature)) {
      await getDb().webhookEvent.create({
        data: {
          id: randomUUID(),
          provider: "whatsapp",
          externalEventId: randomUUID(),
          merchantId: channel.merchantId,
          signatureValid: false,
          status: "FAILED",
          payload: (req.body ?? {}) as unknown as Json,
        },
      });
      return { ok: false, error: "invalid_signature" };
    }

    const statuses = extractStatuses(req.body as unknown as Parameters<typeof extractStatuses>[0]);
    let processed = 0;
    let replayed = 0;
    for (const s of statuses) {
      // ponytail: replay protection. Meta retries the same delivery; dedupe on the
      // stable (message id, status) key so a resent status is not processed twice.
      // Single-process dedup only; add a unique DB constraint if concurrent retries
      // across instances become a concern.
      const eventId = `${s.id}:${s.status}`;
      const prior = await getDb().webhookEvent.findFirst({
        where: { provider: "whatsapp", externalEventId: eventId, merchantId: channel.merchantId },
        select: { id: true },
      });
      if (prior) {
        replayed++;
        continue;
      }
      const updated = await getDb().notification.updateMany({
        where: { externalId: s.id, channelId },
        data: { status: s.status },
      });
      if (updated.count > 0) processed++;
      await getDb().webhookEvent.create({
        data: {
          id: randomUUID(),
          provider: "whatsapp",
          externalEventId: eventId,
          merchantId: channel.merchantId,
          signatureValid: true,
          status: "PROCESSED",
          payload: (req.body ?? {}) as unknown as Json,
        },
      });
    }

    return { ok: true, processed, replayed };
  }
}
