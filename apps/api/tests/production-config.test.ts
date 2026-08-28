import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProductionSecrets, allowedOriginsFromEnv } from "../src/common/security/production-config";

test("validateProductionSecrets throws in production when secrets are missing/dev", () => {
  assert.throws(() => validateProductionSecrets({ NODE_ENV: "production" }));
  assert.throws(() => validateProductionSecrets({ NODE_ENV: "production", JWT_SECRET: "change-me", ENCRYPTION_KEY: "k" }));
});

test("validateProductionSecrets passes in production with real secrets", () => {
  assert.doesNotThrow(() =>
    validateProductionSecrets({ NODE_ENV: "production", JWT_SECRET: "strong", ENCRYPTION_KEY: "strong" }),
  );
});

test("validateProductionSecrets is a no-op outside production", () => {
  assert.doesNotThrow(() => validateProductionSecrets({ NODE_ENV: "development" }));
  assert.doesNotThrow(() => validateProductionSecrets({}));
});

test("allowedOriginsFromEnv reads ALLOWED_ORIGINS, else localhost dev list", () => {
  assert.deepEqual(allowedOriginsFromEnv({ ALLOWED_ORIGINS: "https://a.com, https://b.com" }), [
    "https://a.com",
    "https://b.com",
  ]);
  assert.ok(allowedOriginsFromEnv({}).includes("http://localhost:3000"));
});
