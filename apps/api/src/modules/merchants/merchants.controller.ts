import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { JwtPayload } from "../../common/auth/jwt";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";
import { MerchantsService } from "./merchants.service";

const createMerchantSchema = z.object({
  name: z.string().min(1).max(120),
});

const addMemberSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["VIEWER", "MANAGER", "ADMIN"]),
});

@Controller("v1")
@UseGuards(JwtAuthGuard)
export class MerchantsController {
  // tsx/esbuild does not emit design:paramtypes, so class-type injection needs an explicit token
  constructor(@Inject(MerchantsService) private readonly merchants: MerchantsService) {}

  @Post("merchants")
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createMerchantSchema)) body: z.infer<typeof createMerchantSchema>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.merchants.create(user.sub, body.name);
  }

  @Get("me/memberships")
  listMemberships(@CurrentUser() user: JwtPayload) {
    return this.merchants.listMemberships(user.sub);
  }

  @Get("merchants/:merchantId/members")
  @UseGuards(TenantAccessGuard)
  @RequireMerchantRole("VIEWER")
  listMembers(@Param("merchantId") merchantId: string) {
    return this.merchants.listMembers(merchantId);
  }

  @Post("merchants/:merchantId/members")
  @HttpCode(201)
  @UseGuards(TenantAccessGuard)
  @RequireMerchantRole("ADMIN")
  addMember(
    @Param("merchantId") merchantId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: z.infer<typeof addMemberSchema>,
  ) {
    return this.merchants.addMember(merchantId, body.email, body.role);
  }
}
