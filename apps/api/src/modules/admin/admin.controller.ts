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

  @Get("products")
  listProducts() {
    return this.db.product.findMany({
      select: {
        id: true,
        merchantId: true,
        websiteId: true,
        name: true,
        brand: true,
        priceMinor: true,
        currency: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get("customers")
  listCustomers() {
    return this.db.customer.findMany({
      select: {
        id: true,
        merchantId: true,
        email: true,
        phone: true,
        name: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get("events")
  listEvents() {
    return this.db.event.findMany({
      select: {
        id: true,
        eventId: true,
        merchantId: true,
        websiteId: true,
        eventType: true,
        source: true,
        occurredAt: true,
        ingestedAt: true,
      },
      orderBy: { occurredAt: "desc" },
    });
  }

  @Get("conversations")
  listConversations() {
    return this.db.conversation.findMany({
      select: {
        id: true,
        merchantId: true,
        customerId: true,
        channel: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get("agents")
  listAgents() {
    return this.db.agentRun.findMany({
      select: {
        id: true,
        merchantId: true,
        agentType: true,
        conversationId: true,
        status: true,
        modelProvider: true,
        model: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { startedAt: "desc" },
    });
  }

  @Get("orders")
  listOrders() {
    return this.db.order.findMany({
      select: {
        id: true,
        merchantId: true,
        customerId: true,
        status: true,
        subtotalMinor: true,
        totalMinor: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get("payments")
  listPayments() {
    return this.db.payment.findMany({
      select: {
        id: true,
        merchantId: true,
        orderId: true,
        customerId: true,
        state: true,
        amountMinor: true,
        currency: true,
        method: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
