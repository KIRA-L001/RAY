import "dotenv/config";
import { getDb } from "@ray/database";

async function main() {
  const db = getDb();
  const users = await db.user.findMany({ select: { email: true, adminRole: true } });
  const memberships = await db.membership.findMany({
    select: { role: true, user: { select: { email: true } }, merchant: { select: { slug: true } } },
  });
  const websites = await db.website.findMany({ select: { hostname: true, status: true, merchant: { select: { slug: true } } } });
  console.log(JSON.stringify({ users, memberships, websites }, null, 2));
  await db.$disconnect();
}
main();
