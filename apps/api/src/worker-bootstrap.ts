import { NotificationService } from "./modules/notifications/notification.service";
import { WhatsAppProvider } from "./modules/notifications/whatsapp.provider";
import { startNotificationWorker } from "./modules/notifications/notification.queue";

// ponytail: notification worker sidecar. Run with `pnpm --filter @ray/api
// worker`. Shares the BullMQ Redis with the API process, which enqueues jobs
// via enqueueNotification. Scale by running more of this process.
const service = new NotificationService();
service.register(new WhatsAppProvider());
startNotificationWorker(service);
console.log("notification worker started");
