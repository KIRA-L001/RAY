import "reflect-metadata";
import { config } from "dotenv";
// pnpm --filter runs from apps/api; the shared .env lives at the repo root
config({ path: "../../.env" });
config();
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Logger } from "nestjs-pino";
import type { FastifyRequest } from "fastify";
import { AppModule } from "./app.module";
import { validateProductionSecrets, allowedOriginsFromEnv } from "./common/security/production-config";

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID(),
  });
  // ponytail: raw request bytes are captured natively via `rawBody: true` (below) so
  // webhook HMAC uses the exact payload. Registering our own JSON parser here conflicted
  // with Nest's parser (FST_ERR_CTP_ALREADY_PRESENT); let Nest own body parsing.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));

  // ponytail: fail fast in production if secrets are missing/dev defaults (Task 123).
  validateProductionSecrets();

  adapter.getInstance().addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  await app.register(cookie);
  // Per-request CORS: strict credential allowlist for first-party apps;
  // /v1/events reflects any origin without credentials (public browser sensor).
  const allowedOrigins = allowedOriginsFromEnv();
  await app.register(cors, {
    delegator: async (req: FastifyRequest) => {
      if (req.url.startsWith("/v1/events")) {
        return {
          origin: req.headers.origin ?? "*",
          credentials: false,
          methods: ["POST", "OPTIONS"],
          allowedHeaders: ["content-type", "authorization"],
        };
      }
      return {
        origin: allowedOrigins,
        credentials: true,
      };
    },
  });
  await app.register(helmet, { contentSecurityPolicy: false });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  app.get(Logger).log(`ray-api listening on ${port}`);
}

void bootstrap();

