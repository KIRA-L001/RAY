import { Module } from "@nestjs/common";
import { AuthService } from "../../common/auth/auth.service";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { AuthController } from "./auth.controller";

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
