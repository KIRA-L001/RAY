import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

const ASSIGNABLE_ROLES = ["VIEWER", "MANAGER", "ADMIN"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "merchant"
  );
}

@Injectable()
export class MerchantsService {
  private readonly db = getDb();

  async create(userId: string, name: string) {
    // Find a free slug; bounded retries then give up loudly.
    let slug = slugify(name);
    for (let i = 2; i < 100; i++) {
      const taken = await this.db.merchant.findUnique({ where: { slug } });
      if (!taken) break;
      if (i === 99) throw new AppException(409, "SLUG_EXHAUSTED", "Could not derive a unique slug");
      slug = `${slugify(name)}-${i}`;
    }

    const merchant = await this.db.merchant.create({
      data: {
        id: newId("merchant"),
        name,
        slug,
        memberships: { create: { id: newId("member"), userId, role: "OWNER" } },
      },
    });
    return { id: merchant.id, name: merchant.name, slug: merchant.slug };
  }

  async listMemberships(userId: string) {
    const memberships = await this.db.membership.findMany({
      where: { userId },
      include: { merchant: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({
      merchantId: m.merchantId,
      name: m.merchant.name,
      slug: m.merchant.slug,
      role: m.role,
    }));
  }

  async listMembers(merchantId: string) {
    const memberships = await this.db.membership.findMany({
      where: { merchantId },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      role: m.role,
    }));
  }

  /** Adds an EXISTING user as a member. Email invites need notification infra (Phase 9). */
  async addMember(merchantId: string, email: string, role: AssignableRole) {
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new AppException(400, "INVALID_ROLE", `Role must be one of ${ASSIGNABLE_ROLES.join(", ")}`);
    }
    const user = await this.db.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
    if (!user) {
      // No signup-by-invite flow yet: do not reveal whether the email exists to non-admins... admins here are tenant-trusted; still keep it generic.
      throw new AppException(404, "USER_NOT_FOUND", "No user found with that email");
    }
    const dupe = await this.db.membership.findUnique({
      where: { userId_merchantId: { userId: user.id, merchantId } },
    });
    if (dupe) {
      throw new AppException(409, "ALREADY_MEMBER", "User is already a member of this merchant");
    }
    const created = await this.db.membership.create({
      data: { id: newId("member"), userId: user.id, merchantId, role },
    });
    return { userId: created.userId, role: created.role };
  }
}
