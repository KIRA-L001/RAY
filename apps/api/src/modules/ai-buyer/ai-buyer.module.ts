import { Module } from "@nestjs/common";
import { LlmModule } from "../../common/llm/llm.module";
import { CatalogModule } from "../catalog/catalog.module";
import { CartModule } from "../cart/cart.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { EventsModule } from "../events/events.module";
import { OrdersModule } from "../orders/order.module";
import { AiBuyerController } from "./ai-buyer.controller";
import { AiBuyerService } from "./ai-buyer.service";
import { ShoppingAgentService } from "./shopping-agent.service";

@Module({
  imports: [ConversationsModule, LlmModule, CatalogModule, CartModule, EventsModule, OrdersModule],
  controllers: [AiBuyerController],
  providers: [AiBuyerService, ShoppingAgentService],
})
export class AiBuyerModule {}
