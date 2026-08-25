import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AppException } from "../errors/app.exception";
import { jwtSecret, verifyJwt } from "./jwt";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers["authorization"] as string | undefined;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyJwt(token, jwtSecret()) : null;
    if (!payload) {
      throw new AppException(401, "UNAUTHORIZED", "Missing or invalid access token");
    }
    request.user = payload;
    return true;
  }
}
