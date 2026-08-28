-- Add idempotency keys for order and payment creation (Task 118).
-- Nullable unique: rows without a key (NULL) are not constrained; a provided
-- key must be unique per table, so duplicate submissions collide instead of duplicating.

ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
