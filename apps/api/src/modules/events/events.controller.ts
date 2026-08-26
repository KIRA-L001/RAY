import { Body, Controller, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { eventBatchSchema, type ValidatedEvent } from "./events.schema";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { EventsService } from "./events.service";

@Controller("v1/events")
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  /** Public ingestion: authenticated by publishable site key (never a user JWT). */
  @Post()
  @HttpCode(202)
  ingest(
    @Headers("authorization") authorization: string | undefined,
    @Body(new ZodValidationPipe(eventBatchSchema)) events: ValidatedEvent[],
  ) {
    return this.events.ingest(events, authorization);
  }
}
