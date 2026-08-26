import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { WebsitesModule } from "../websites/websites.module";

@Module({
  imports: [WebsitesModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
