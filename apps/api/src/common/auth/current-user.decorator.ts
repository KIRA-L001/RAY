import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { JwtPayload } from "./jwt";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => context.switchToHttp().getRequest().user,
);
