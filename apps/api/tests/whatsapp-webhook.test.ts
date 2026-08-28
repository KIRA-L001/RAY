import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { extractStatuses, verifyMetaSignature, metaStatusToNotification } from "../src/modules/notifications/whatsapp-webhook";

test("maps Meta statuses to notification statuses", () => {
  assert.equal(metaStatusToNotification("delivered"), "DELIVERED");
  assert.equal(metaStatusToNotification("read"), "READ");
  assert.equal(metaStatusToNotification("failed"), "FAILED");
  assert.equal(metaStatusToNotification("bogus"), null);
});

test("extractStatuses flattens nested payload", () => {
  const payload = {
    entry: [
      { changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }] } }] },
      { changes: [{ value: { statuses: [{ id: "wamid.2", status: "read" }] } }, { value: {} }] },
    ],
  };
  const out = extractStatuses(payload);
  assert.deepEqual(out, [
    { id: "wamid.1", status: "DELIVERED" },
    { id: "wamid.2", status: "READ" },
  ]);
});

test("verifyMetaSignature accepts a correct HMAC", () => {
  const secret = "appsecret";
  const body = Buffer.from('{"entry":[]}');
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, secret, sig), true);
});

test("verifyMetaSignature rejects tampered body and bad prefix", () => {
  const secret = "appsecret";
  const body = Buffer.from("hello");
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyMetaSignature(Buffer.from("hello!"), secret, sig), false);
  assert.equal(verifyMetaSignature(body, secret, "sha1=" + sig.slice(6)), false);
});
