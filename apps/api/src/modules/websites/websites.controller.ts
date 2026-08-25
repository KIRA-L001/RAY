import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RequireMerchantRole, TenantAccessGuard } from "../../common/tenancy/tenant.guard";
import { WebsitesService } from "./websites.service";

const createWebsiteSchema = z.object({
  url: z.string().min(4).max(2048),
});

@Controller("v1/merchants/:merchantId/websites")
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class WebsitesController {
  // tsx/esbuild does not emit design:paramtypes, so class-type injection needs an explicit token
  constructor(@Inject(WebsitesService) private readonly websites: WebsitesService) {}

  @Post()
  @HttpCode(201)
  @RequireMerchantRole("ADMIN")
  create(
    @Param("merchantId") merchantId: string,
    @Body(new ZodValidationPipe(createWebsiteSchema)) body: z.infer<typeof createWebsiteSchema>,
  ) {
    return this.websites.create(merchantId, body.url);
  }

  @Get()
  @RequireMerchantRole("VIEWER")
  list(@Param("merchantId") merchantId: string) {
    return this.websites.listForMerchant(merchantId);
  }

  @Get(":websiteId")
  @RequireMerchantRole("VIEWER")
  get(@Param("merchantId") merchantId: string, @Param("websiteId") websiteId: string) {
    return this.websites.getForMerchant(merchantId, websiteId);
  }
}
