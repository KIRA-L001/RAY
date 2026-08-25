-- CreateTable
CREATE TABLE "CrawlPage" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isCandidate" BOOLEAN NOT NULL DEFAULT false,
    "httpStatus" INTEGER,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrawlPage_websiteId_isCandidate_idx" ON "CrawlPage"("websiteId", "isCandidate");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlPage_websiteId_url_key" ON "CrawlPage"("websiteId", "url");

-- AddForeignKey
ALTER TABLE "CrawlPage" ADD CONSTRAINT "CrawlPage_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
