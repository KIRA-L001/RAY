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

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  adapter.getInstance().addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });
  await app.register(cookie);
  // Per-request CORS: strict credential allowlist for first-party apps;
  // /v1/events reflects any origin without credentials (public browser sensor).
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
        // admin (3000), desktop dev (5173), tauri. Production origins via env (Task 123).
        origin: [
          "http://localhost:3000",
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "tauri://localhost",
          "http://tauri.localhost",
        ],
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

