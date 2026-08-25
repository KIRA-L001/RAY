import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { hashPassword, verifyPassword } from "@ray/types";
import { AppException } from "../errors/app.exception";
import { jwtSecret, signJwt } from "./jwt";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = "ray_refresh";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

// ponytail: in-memory per-process login limiter; move behind Redis when BullMQ/Task 13 lands or API runs multi-instance
const attempts = new Map<string, { count: number; resetAt: number }>();
function throttleLogin(key: string, limit = 10, windowMs = 60_000): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (++entry.count > limit) {
    throw new AppException(429, "RATE_LIMITED", "Too many attempts, try again later");
  }
}

@Injectable()
export class AuthService {
  private readonly db = getDb();

  async register(email: string, password: string) {
    const normalized = email.toLowerCase();
    const existing = await this.db.user.findFirst({ where: { email: normalized } });
    if (existing) {
      throw new AppException(409, "EMAIL_TAKEN", "An account with this email already exists");
    }
    const user = await this.db.user.create({
      data: {
        id: `user_${randomUUID()}`,
        email: normalized,
        passwordHash: hashPassword(password),
      },
    });
    const accessToken = this.signAccessToken(user.id, user.email, user.adminRole);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, refreshToken: refreshToken.token };
  }

  async me(userId: string) {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { memberships: { include: { merchant: true } } },
    });
    if (!user) {
      throw new AppException(404, "USER_NOT_FOUND", "User no longer exists");
    }
    return {
      id: user.id,
      email: user.email,
      adminRole: user.adminRole,
      memberships: user.memberships.map((m) => ({
        merchantId: m.merchantId,
        name: m.merchant.name,
        slug: m.merchant.slug,
        role: m.role,
      })),
    };
  }

  async login(email: string, password: string, ip: string) {
    throttleLogin(`login:${ip}:${email}`);
    const user = await this.db.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null, isActive: true },
    });
    // Same error for unknown email and wrong password: no account enumeration.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AppException(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const accessToken = this.signAccessToken(user.id, user.email, user.adminRole);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, refreshToken: refreshToken.token };
  }

  async refresh(rawToken: string) {
    if (!rawToken) {
      throw new AppException(401, "NO_REFRESH_TOKEN", "Missing refresh token");
    }
    const stored = await this.db.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!stored) {
      throw new AppException(401, "INVALID_REFRESH_TOKEN", "Refresh token not recognized");
    }
    if (stored.revokedAt || stored.expiresAt < new Date()) {
      // Reuse of a rotated/revoked token means the chain may be stolen: kill every session.
      await this.db.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppException(401, "REFRESH_TOKEN_REVOKED", "Session revoked, log in again");
    }

    const user = await this.db.user.findFirst({
      where: { id: stored.userId, deletedAt: null, isActive: true },
    });
    if (!user) {
      throw new AppException(401, "INVALID_REFRESH_TOKEN", "User no longer active");
    }

    const next = await this.issueRefreshToken(user.id);
    await this.db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });

    return {
      accessToken: this.signAccessToken(user.id, user.email, user.adminRole),
      expiresIn: ACCESS_TTL_SECONDS,
      refreshToken: next.token,
    };
  }

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    await this.db.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signAccessToken(userId: string, email: string, adminRole: string | null): string {
    return signJwt({ sub: userId, email, adminRole }, jwtSecret(), ACCESS_TTL_SECONDS);
  }

  private async issueRefreshToken(userId: string) {
    const token = randomBytes(32).toString("hex");
    const created = await this.db.refreshToken.create({
      data: {
        id: `rt_${randomUUID()}`,
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { id: created.id, token };
  }
}
