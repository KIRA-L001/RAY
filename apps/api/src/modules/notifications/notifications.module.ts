import { Module } from "@nestjs/common";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";
import { NotificationsController } from "./notifications.controller";

@Module({ controllers: [WhatsAppWebhookController, NotificationsController] })
export class NotificationsModule {}
