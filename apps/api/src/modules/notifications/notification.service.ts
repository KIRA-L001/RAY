import { getDb } from "@ray/database";
import { decryptJson } from "./crypto";

export interface NotificationSendInput {
  to: string;
  body: string;
  config: Record<string, unknown>;
  purpose?: string;
}

export interface NotificationSendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface NotificationProvider {
  readonly channelType: string;
  send(input: NotificationSendInput): Promise<NotificationSendResult>;
}

/** Resolves a merchant's configured channel of a given type. */
export type ChannelResolver = (
  merchantId: string,
  channelType: string,
) => Promise<{ id: string; status: string; encryptedConfig: string } | null>;

/** Returns true when the customer has opted in to be messaged on this channel. */
export type ConsentResolver = (customerId: string) => Promise<boolean>;

async function defaultChannelResolver(
  merchantId: string,
  channelType: string,
): Promise<{ id: string; status: string; encryptedConfig: string } | null> {
  const channel = await getDb().notificationChannel.findFirst({
    where: { merchantId, type: channelType },
    select: { id: true, status: true, encryptedConfig: true },
  });
  return channel;
}

// ponytail: single WhatsApp opt-in flag on Customer. If more channels gain
// consent, replace with a per-channel consent row keyed by (customer, channel).
async function defaultConsentResolver(customerId: string): Promise<boolean> {
  const customer = await getDb().customer.findUnique({
    where: { id: customerId },
    select: { whatsappOptIn: true },
  });
  return customer?.whatsappOptIn ?? false;
}

export class NotificationService {
  private readonly providers = new Map<string, NotificationProvider>();

  constructor(
    private readonly channelResolver: ChannelResolver = defaultChannelResolver,
    private readonly consentResolver: ConsentResolver = defaultConsentResolver,
  ) {}

  register(provider: NotificationProvider): void {
    this.providers.set(provider.channelType, provider);
  }

  async send(opts: {
    merchantId: string;
    channelType: string;
    to: string;
    body: string;
    purpose?: string;
    customerId?: string;
  }): Promise<NotificationSendResult> {
    const channel = await this.channelResolver(opts.merchantId, opts.channelType);
    if (!channel) return { ok: false, error: "channel_not_found" };
    if (channel.status !== "CONNECTED") return { ok: false, error: "channel_not_connected" };
    if (opts.customerId && !(await this.consentResolver(opts.customerId))) {
      return { ok: false, error: "consent_required" };
    }
    const provider = this.providers.get(opts.channelType);
    if (!provider) return { ok: false, error: "no_provider" };
    return provider.send({
      to: opts.to,
      body: opts.body,
      config: decryptJson<Record<string, unknown>>(channel.encryptedConfig),
      purpose: opts.purpose,
    });
  }
}
