import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
        genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-api-key"]'],
          censor: "[REDACTED]",
        },
        customProps: () => ({ service: "ray-api" }),
      },
    }),
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
