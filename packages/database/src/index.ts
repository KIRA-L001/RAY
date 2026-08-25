import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.ts";

export type Db = PrismaClient;

let instance: PrismaClient | undefined;

export function getDb(connectionString?: string): PrismaClient {
  if (!instance) {
    const url = connectionString ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    instance = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  return instance;
}
