import { Injectable } from "@nestjs/common";
import { getDb } from "@ray/database";
import { newId } from "@ray/types";
import { AppException } from "../../common/errors/app.exception";

@Injectable()
export class WebsitesService {
  private readonly db = getDb();

  async create(merchantId: string, rawUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new AppException(400, "INVALID_URL", "Invalid website URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AppException(400, "INVALID_URL", "URL must use http or https");
    }
    const hostname = parsed.hostname.toLowerCase();

    const dupe = await this.db.website.findFirst({ where: { merchantId, hostname, deletedAt: null } });
    if (dupe) {
      throw new AppException(409, "WEBSITE_EXISTS", "This hostname is already registered");
    }

    const website = await this.db.website.create({
      data: { id: newId("site"), merchantId, url: parsed.toString(), hostname },
    });
    return {
      id: website.id,
      merchantId: website.merchantId,
      url: website.url,
      hostname: website.hostname,
      status: website.status,
    };
  }

  async listForMerchant(merchantId: string) {
    const websites = await this.db.website.findMany({
      where: { merchantId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return websites.map((w) => ({
      id: w.id,
      url: w.url,
      hostname: w.hostname,
      status: w.status,
      errorCode: w.errorCode,
      createdAt: w.createdAt,
    }));
  }

  /** Ownership chain enforced: website must belong to the guard-verified merchantId. */
  async getForMerchant(merchantId: string, websiteId: string) {
    const website = await this.db.website.findFirst({
      where: { id: websiteId, merchantId, deletedAt: null },
    });
    if (!website) {
      throw new AppException(404, "WEBSITE_NOT_FOUND", "Website not found");
    }
    return {
      id: website.id,
      url: website.url,
      hostname: website.hostname,
      status: website.status,
      errorCode: website.errorCode,
      errorMessage: website.errorMessage,
      retryCount: website.retryCount,
      readyAt: website.readyAt,
      createdAt: website.createdAt,
    };
  }
}
