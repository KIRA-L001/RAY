import type {
  NotificationProvider,
  NotificationSendInput,
  NotificationSendResult,
} from "./notification.service";

interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion?: string;
}

export const WHATSAPP_CHANNEL = "WHATSAPP";

export class WhatsAppProvider implements NotificationProvider {
  readonly channelType = WHATSAPP_CHANNEL;

  // ponytail: fetch injected for tests; real calls use global fetch.
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const { token, phoneNumberId, apiVersion = "v21.0" } = input.config as unknown as WhatsAppConfig;
    if (!token || !phoneNumberId) return { ok: false, error: "whatsapp_config_missing" };

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.body },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `whatsapp_http_${res.status}: ${detail.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { ok: true, externalId: data.messages?.[0]?.id };
  }
}
