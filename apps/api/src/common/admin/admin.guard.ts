import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JwtPayload } from "../auth/jwt";
import { AppException } from "../errors/app.exception";

// ponytail: linear rank is a simplification (OPERATIONS/SUPPORT differ by function, not level); split into permission sets if real conflicts appear
export const ADMIN_RANK = { READ_ONLY: 1, SUPPORT: 2, OPERATIONS: 3, SUPER_ADMIN: 4 } as const;
export type AdminRoleName = keyof typeof ADMIN_RANK;

const MIN_ADMIN_ROLE_KEY = "minAdminRole";
export const RequireAdminRole = (role: AdminRoleName) => SetMetadata(MIN_ADMIN_ROLE_KEY, role);

// tsx/esbuild does not emit design:paramtypes, so class-type injection needs an explicit token
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Role comes from the short-lived access-token claim; worst case a demoted admin keeps access for <=15min.
    const user = context.switchToHttp().getRequest().user as JwtPayload | undefined;
    const role = user?.adminRole ?? null;
    if (!role || !(role in ADMIN_RANK)) {
      throw new AppException(403, "FORBIDDEN", "RAY admin access required");
    }
    const min = this.reflector.get<AdminRoleName>(MIN_ADMIN_ROLE_KEY, context.getHandler()) ?? "READ_ONLY";
    if (ADMIN_RANK[role as AdminRoleName] < ADMIN_RANK[min]) {
      throw new AppException(403, "FORBIDDEN", `Requires ${min} role`);
    }
    return true;
  }
}
