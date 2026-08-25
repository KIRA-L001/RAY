import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";
import { z } from "zod";
import { CatalogService } from "./catalog.service";

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

@Controller("v1/merchants/:merchantId")
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class CatalogController {
  // tsx/esbuild does not emit design:paramtypes, so class-type injection needs an explicit token
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get("products")
  @RequireMerchantRole("VIEWER")
  listProducts(
    @Param("merchantId") merchantId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.catalog.listProducts(merchantId, query.limit ?? 50);
  }

  @Post("websites/:websiteId/recrawl")
  @HttpCode(202)
  @RequireMerchantRole("ADMIN")
  recrawl(@Param("merchantId") merchantId: string, @Param("websiteId") websiteId: string) {
    return this.catalog.triggerRecrawl(merchantId, websiteId);
  }
}
