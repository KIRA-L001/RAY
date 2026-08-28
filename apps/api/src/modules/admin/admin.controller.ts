import { Controller, Get, UseGuards } from "@nestjs/common";
import { getDb } from "@ray/database";
import { AdminGuard } from "../../common/admin/admin.guard";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";

@Controller("v1/admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  private readonly db = getDb();

  @Get("merchants")
  listMerchants() {
    return this.db.merchant.findMany({
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get("websites")
  listWebsites() {
    return this.db.website.findMany({
      select: {
        id: true,
        merchantId: true,
        url: true,
        hostname: true,
        status: true,
        errorCode: true,
        retryCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
