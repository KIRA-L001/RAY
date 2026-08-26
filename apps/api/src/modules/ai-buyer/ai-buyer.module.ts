import { Module } from "@nestjs/common";
import { LlmModule } from "../../common/llm/llm.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { AiBuyerController } from "./ai-buyer.controller";
import { AiBuyerService } from "./ai-buyer.service";

@Module({
  imports: [ConversationsModule, LlmModule],
  controllers: [AiBuyerController],
  providers: [AiBuyerService],
})
export class AiBuyerModule {}
