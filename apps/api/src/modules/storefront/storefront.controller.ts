import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { getDb } from "@ray/database";

@Controller("v1/storefronts")
export class StorefrontController {
  private readonly db = getDb();

  /** Public: only non-sensitive merchant display fields. */
  @Get(":slug")
  async getBySlug(@Param("slug") slug: string) {
    const merchant = await this.db.merchant.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true },
    });
    if (!merchant) {
      throw new NotFoundException({ code: "STOREFRONT_NOT_FOUND", message: "Storefront not found" });
    }
    return merchant;
  }
}
