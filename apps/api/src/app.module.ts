import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { ApiEnvelopeInterceptor } from "./common/interceptors/api-envelope.interceptor";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { MerchantsModule } from "./modules/merchants/merchants.module";
import { AdminModule } from "./modules/admin/admin.module";
import { StorefrontModule } from "./modules/storefront/storefront.module";
import { WebsitesModule } from "./modules/websites/websites.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { EventsModule } from "./modules/events/events.module";

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
    AuthModule,
    MerchantsModule,
    AdminModule,
    StorefrontModule,
    WebsitesModule,
    CategoriesModule,
    CatalogModule,
    EventsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
  ],
})
export class AppModule {}
