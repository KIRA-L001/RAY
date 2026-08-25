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
import { Logger } from "nestjs-pino";
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
  await app.register(helmet, { contentSecurityPolicy: false });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  app.get(Logger).log(`ray-api listening on ${port}`);
}

void bootstrap();

