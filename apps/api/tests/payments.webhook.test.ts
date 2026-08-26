import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PaymentsController } from "../src/modules/payments/payments.controller";
import type { RazorpayAdapter } from "../src/modules/payments/razorpay.adapter";
import type { RazorpayWebhookBody } from "../src/modules/payments/payment.service";

const BODY = '{"event":"payment.captured","payload":{"payment":{"entity":{"order_id":"rz-1","id":"pay-1"}}}}';
const GOOD_SIG = "good";

function makeController(verifyResult: boolean, calls: RazorpayWebhookBody[] = []) {
  const razorpay = {
    verifyWebhookSignature: (_body: string, sig: string) => sig === GOOD_SIG && verifyResult,
  } as unknown as RazorpayAdapter;
  const payments = { handleRazorpayWebhook: async (e: RazorpayWebhookBody) => { calls.push(e); return { ok: true }; } };
  return { controller: new PaymentsController(razorpay, payments as never), calls };
}

function req() {
  return { rawBody: Buffer.from(BODY), body: JSON.parse(BODY) } as never;
}

test("webhook with valid signature delegates to the payment service", async () => {
  const calls: RazorpayWebhookBody[] = [];
  const { controller } = makeController(true, calls);
  const res = await controller.razorpayWebhook(req(), GOOD_SIG);
  assert.deepEqual(res, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.payload?.payment?.entity?.order_id, "rz-1");
});

test("webhook with bad signature is rejected without calling the service", async () => {
  const calls: RazorpayWebhookBody[] = [];
  const { controller } = makeController(false, calls);
  const res = await controller.razorpayWebhook(req(), "bad");
  assert.deepEqual(res, { ok: false, error: "invalid_signature" });
  assert.equal(calls.length, 0);
});

test("webhook without a signature is rejected", async () => {
  const calls: RazorpayWebhookBody[] = [];
  const { controller } = makeController(true, calls);
  const res = await controller.razorpayWebhook(req(), "");
  assert.deepEqual(res, { ok: false, error: "missing_signature" });
  assert.equal(calls.length, 0);
});
