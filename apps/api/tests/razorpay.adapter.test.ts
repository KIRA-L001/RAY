import "reflect-metadata";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { RazorpayAdapter } from "../src/modules/payments/razorpay.adapter";

const config = { keyId: "k", keySecret: "sec", webhookSecret: "whsec", testMode: true };

test("verifyPaymentSignature accepts a correct HMAC and rejects a wrong one", () => {
  const adapter = new RazorpayAdapter(config);
  const sig = crypto.createHmac("sha256", "sec").update("o1|p1").digest("hex");
  assert.equal(adapter.verifyPaymentSignature("o1", "p1", sig), true);
  assert.equal(adapter.verifyPaymentSignature("o1", "p1", "deadbeef"), false);
});

test("verifyWebhookSignature validates the webhook HMAC", () => {
  const adapter = new RazorpayAdapter(config);
  const body = '{"event":"payment.captured"}';
  const sig = crypto.createHmac("sha256", "whsec").update(body).digest("hex");
  assert.equal(adapter.verifyWebhookSignature(body, sig), true);
  assert.equal(adapter.verifyWebhookSignature(body, "nope"), false);
});

test("missing secrets fail closed", () => {
  const adapter = new RazorpayAdapter({ keyId: "", keySecret: "", webhookSecret: "", testMode: false });
  assert.equal(adapter.verifyPaymentSignature("o1", "p1", "x"), false);
  assert.equal(adapter.verifyWebhookSignature("b", "x"), false);
});
