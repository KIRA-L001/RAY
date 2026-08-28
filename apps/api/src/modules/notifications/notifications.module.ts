import { Module } from "@nestjs/common";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";

@Module({ controllers: [WhatsAppWebhookController] })
export class NotificationsModule {}
