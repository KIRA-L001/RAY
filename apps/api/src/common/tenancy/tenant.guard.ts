import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getDb } from "@ray/database";
import { AppException } from "../errors/app.exception";

export const ROLE_RANK = { VIEWER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 } as const;
export type MerchantRoleName = keyof typeof ROLE_RANK;

export const MIN_MERCHANT_ROLE_KEY = "minMerchantRole";
export const RequireMerchantRole = (role: MerchantRoleName) =>
  SetMetadata(MIN_MERCHANT_ROLE_KEY, role);

// tsx/esbuild does not emit design:paramtypes, so class-type injection needs an explicit token
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const merchantId = request.params?.merchantId as string | undefined;
    const userId = request.user?.sub as string | undefined;
    if (!merchantId || !userId) {
      throw new AppException(400, "TENANT_CONTEXT_ERROR", "Missing merchant context");
    }

    const minRole = this.reflector.get<MerchantRoleName>(MIN_MERCHANT_ROLE_KEY, context.getHandler()) ?? "VIEWER";
    const membership = await getDb().membership.findUnique({
      where: { userId_merchantId: { userId, merchantId } },
    });
    if (!membership) {
      // Same response whether the merchant does not exist or belongs to someone else: no probing.
      throw new AppException(403, "FORBIDDEN", "You are not a member of this merchant");
    }
    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      throw new AppException(403, "FORBIDDEN", `Requires ${minRole} role`);
    }
    request.membership = membership;
    return true;
  }
}
