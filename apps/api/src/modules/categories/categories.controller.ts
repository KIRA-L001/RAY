import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { getDb } from "@ray/database";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";

@Controller("v1/merchants/:merchantId/categories")
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@RequireMerchantRole("VIEWER")
export class CategoriesController {
  private readonly db = getDb();

  @Get()
  list(@Param("merchantId") merchantId: string) {
    return this.db.category.findMany({
      where: { merchantId, deletedAt: null },
      select: { id: true, name: true, slug: true, _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
  }
}
