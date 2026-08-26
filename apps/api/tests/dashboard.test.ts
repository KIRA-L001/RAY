import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DashboardController } from "../src/modules/dashboard/dashboard.controller";
import type { DashboardService } from "../src/modules/dashboard/dashboard.service";

test("dashboard endpoint delegates to the service scoped by merchantId", async () => {
  const calls: string[] = [];
  const service = {
    summary: async (merchantId: string) => {
      calls.push(merchantId);
      return { products: 1, orders: 2, customers: 3, newCustomers30d: 1, identifiedCustomers: 2, conversations: 4, activeConversations: 2, totalMessages: 10, avgMessagesPerConversation: 2.5, topProducts: [], newProducts30d: 1, revenueMinor: 500, aiRevenueMinor: 200, averageOrderValueMinor: 250, ordersByStatus: { PAID: 1, CREATED: 1 }, currency: "INR" };
    },
  } as unknown as DashboardService;
  const controller = new DashboardController(service);
  const res = await controller.summary("m-tenant-a");
  assert.equal(res.products, 1);
  assert.deepEqual(calls, ["m-tenant-a"]);
});
