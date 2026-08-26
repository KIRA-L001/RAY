-- Publishable site key for SDK site identity (Task 35).
-- Backfills existing rows, then removes the default so the app always generates keys.
ALTER TABLE "Website" ADD COLUMN "publicKey" TEXT NOT NULL DEFAULT ('sitekey_' || encode(sha256((random()::text || clock_timestamp()::text)::bytea), 'hex'));
ALTER TABLE "Website" ALTER COLUMN "publicKey" DROP DEFAULT;
CREATE UNIQUE INDEX "Website_publicKey_key" ON "Website"("publicKey");
