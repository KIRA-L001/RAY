import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

/** Membership row attached by TenantAccessGuard. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): { id: string; merchantId: string; userId: string; role: string } =>
    context.switchToHttp().getRequest().membership,
);
