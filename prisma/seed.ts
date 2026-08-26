import "dotenv/config";
import { getDb } from "@ray/database";
import { hashPassword, newId } from "@ray/types";

const db = getDb();

async function main() {
  const adminEmail = process.env.ADMIN_ALLOWED_EMAILS?.split(",")[0]?.trim() || "admin@ray.local";
  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      id: newId("user"),
      email: adminEmail,
      passwordHash: hashPassword("admin123"),
      adminRole: "SUPER_ADMIN",
    },
  });
  const adminId = admin.id;

  const merchantDefs = [
    { name: "Acme Retail", slug: "acme", sites: ["https://acme.example.com"] },
    { name: "Bombay Threads", slug: "bombay-threads", sites: ["https://bombaythreads.example.com", "https://sale.bombaythreads.example.com"] },
  ];

  for (const def of merchantDefs) {
    const merchant = await db.merchant.upsert({
      where: { slug: def.slug },
      update: {},
      create: { id: newId("merchant"), name: def.name, slug: def.slug },
    });

    await db.membership.upsert({
      where: { userId_merchantId: { userId: adminId, merchantId: merchant.id } },
      update: {},
      create: { id: newId("member"), userId: adminId, merchantId: merchant.id, role: "OWNER" },
    });

    for (const url of def.sites) {
      const hostname = new URL(url).hostname;
      const existing = await db.website.findFirst({ where: { merchantId: merchant.id, hostname } });
      if (!existing) {
        await db.website.create({
          data: {
            id: newId("site"),
            merchantId: merchant.id,
            publicKey: newId("sitekey"),
            url,
            hostname,
            status: "PENDING",
          },
        });
      }
    }
  }

  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
