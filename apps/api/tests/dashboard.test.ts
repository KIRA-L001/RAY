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
      return { products: 1, orders: 2, customers: 3, conversations: 4, revenueMinor: 500, aiRevenueMinor: 200, currency: "INR" };
    },
  } as unknown as DashboardService;
  const controller = new DashboardController(service);
  const res = await controller.summary("m-tenant-a");
  assert.equal(res.products, 1);
  assert.deepEqual(calls, ["m-tenant-a"]);
});
