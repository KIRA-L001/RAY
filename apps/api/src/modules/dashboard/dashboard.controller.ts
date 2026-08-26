import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";
import { type DashboardSummary, DashboardService } from "./dashboard.service";

@Controller("v1")
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@RequireMerchantRole("VIEWER")
export class DashboardController {
  // tsx/esbuild does not emit design:paramtypes, so class-type injection needs explicit @Inject.
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get("merchants/:merchantId/dashboard")
  summary(@Param("merchantId") merchantId: string): Promise<DashboardSummary> {
    return this.dashboard.summary(merchantId);
  }
}
