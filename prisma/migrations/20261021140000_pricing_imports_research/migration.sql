-- CreateEnum
CREATE TYPE "PriceListKind" AS ENUM ('COST', 'SALE', 'REFERENCE');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PARSED', 'CONFIRMED', 'APPLYING', 'COMPLETED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'CONFLICT', 'APPLIED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('PENDING', 'QUEUED', 'IN_PROGRESS', 'NEEDS_REVIEW', 'ENRICHED', 'NO_DATA', 'FAILED');

-- CreateEnum
CREATE TYPE "OfferOrigin" AS ENUM ('ENGINE', 'MANUAL', 'IMPORT_PRELIMINARY');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('CANDIDATE', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OfferCondition" AS ENUM ('NEW', 'USED', 'REFURBISHED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ResearchAssetKind" AS ENUM ('IMAGE', 'DATASHEET', 'MANUAL', 'OFFICIAL_PAGE', 'SPEC');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('OFFICIAL', 'AUTHORIZED_DISTRIBUTOR', 'MARKETPLACE', 'RESELLER', 'OTHER');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'PAUSED', 'CANCELED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('RESEARCH_PRODUCT', 'IMPORT_APPLY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "lastResearchAt" TIMESTAMPTZ(3),
ADD COLUMN     "researchStatus" "ResearchStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "suggestedManufacturer" TEXT,
ADD COLUMN     "suggestedModel" TEXT;

-- CreateTable
CREATE TABLE "price_list" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "supplier" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "kind" "PriceListKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "PriceSource" NOT NULL,
    "importRowId" UUID,
    "supersedesId" UUID,
    "reason" TEXT,
    "createdById" UUID NOT NULL,

    CONSTRAINT "price_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_config" (
    "tenantId" UUID NOT NULL,
    "markup" DECIMAL(6,4) NOT NULL DEFAULT 0.45,
    "markupMax" DECIMAL(6,4) NOT NULL DEFAULT 0.45,
    "webUplift" DECIMAL(6,4) NOT NULL DEFAULT 0.15,
    "minOffersForMedian" INTEGER NOT NULL DEFAULT 3,
    "offerMaxAgeDays" INTEGER NOT NULL DEFAULT 90,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "supplier" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "parserVersion" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PARSED',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "effectiveAt" TIMESTAMPTZ(3),
    "updatePolicy" JSONB NOT NULL DEFAULT '{}',
    "justification" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "status" "ImportRowStatus" NOT NULL,
    "action" TEXT,
    "matchedProductId" UUID,
    "appliedAt" TIMESTAMPTZ(3),

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_offer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "shipping" DECIMAL(18,4),
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "condition" "OfferCondition" NOT NULL DEFAULT 'UNKNOWN',
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "origin" "OfferOrigin" NOT NULL,
    "isListingPage" BOOLEAN NOT NULL DEFAULT false,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "matchReasons" JSONB NOT NULL DEFAULT '[]',
    "status" "ReviewStatus" NOT NULL DEFAULT 'CANDIDATE',
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "runId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_asset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kind" "ResearchAssetKind" NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "title" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "status" "ReviewStatus" NOT NULL DEFAULT 'CANDIDATE',
    "mediaId" UUID,
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "origin" "OfferOrigin" NOT NULL,
    "runId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "providers" JSONB NOT NULL DEFAULT '[]',
    "maxApiCalls" INTEGER NOT NULL,
    "maxCostCents" INTEGER NOT NULL,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "totalJobs" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "research_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "runId" UUID,
    "productId" UUID,
    "batchId" UUID,
    "actorId" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_usage" (
    "provider" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provider_usage_pkey" PRIMARY KEY ("provider","day")
);

-- CreateTable
CREATE TABLE "api_credential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_list_tenantId_id_key" ON "price_list"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_tenantId_normalizedName_key" ON "price_list"("tenantId", "normalizedName");

-- CreateIndex
CREATE INDEX "price_entry_tenantId_productId_priceListId_effectiveAt_reco_idx" ON "price_entry"("tenantId", "productId", "priceListId", "effectiveAt", "recordedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_entry_tenantId_id_key" ON "price_entry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_entry_importRowId_key" ON "price_entry"("importRowId");

-- CreateIndex
CREATE INDEX "import_batch_tenantId_createdAt_idx" ON "import_batch"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "import_batch_tenantId_sha256_idx" ON "import_batch"("tenantId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "import_batch_tenantId_id_key" ON "import_batch"("tenantId", "id");

-- CreateIndex
CREATE INDEX "import_row_tenantId_batchId_status_idx" ON "import_row"("tenantId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_tenantId_id_key" ON "import_row"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_batchId_rowNumber_key" ON "import_row"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "market_offer_tenantId_productId_status_observedAt_idx" ON "market_offer"("tenantId", "productId", "status", "observedAt");

-- CreateIndex
CREATE INDEX "market_offer_tenantId_status_idx" ON "market_offer"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "market_offer_tenantId_productId_provider_url_observedAt_key" ON "market_offer"("tenantId", "productId", "provider", "url", "observedAt");

-- CreateIndex
CREATE INDEX "research_asset_tenantId_productId_kind_status_idx" ON "research_asset"("tenantId", "productId", "kind", "status");

-- CreateIndex
CREATE INDEX "research_asset_tenantId_status_idx" ON "research_asset"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "research_asset_tenantId_productId_kind_url_key" ON "research_asset"("tenantId", "productId", "kind", "url");

-- CreateIndex
CREATE INDEX "research_run_tenantId_createdAt_idx" ON "research_run"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "research_run_tenantId_id_key" ON "research_run"("tenantId", "id");

-- CreateIndex
CREATE INDEX "job_status_runAfter_idx" ON "job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "job_tenantId_runId_status_idx" ON "job"("tenantId", "runId", "status");

-- CreateIndex
CREATE INDEX "job_tenantId_batchId_status_idx" ON "job"("tenantId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_credential_prefix_key" ON "api_credential"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_credential_tokenHash_key" ON "api_credential"("tokenHash");

-- CreateIndex
CREATE INDEX "api_credential_tenantId_idx" ON "api_credential"("tenantId");

-- CreateIndex
CREATE INDEX "product_tenantId_researchStatus_idx" ON "product"("tenantId", "researchStatus");

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_tenantId_priceListId_fkey" FOREIGN KEY ("tenantId", "priceListId") REFERENCES "price_list"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_tenantId_importRowId_fkey" FOREIGN KEY ("tenantId", "importRowId") REFERENCES "import_row"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "import_batch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_tenantId_matchedProductId_fkey" FOREIGN KEY ("tenantId", "matchedProductId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_offer" ADD CONSTRAINT "market_offer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_offer" ADD CONSTRAINT "market_offer_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_asset" ADD CONSTRAINT "research_asset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_asset" ADD CONSTRAINT "research_asset_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "research_run"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_credential" ADD CONSTRAINT "api_credential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints adicionais (mantidas manualmente)
-- ---------------------------------------------------------------------------
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_amount_chk" CHECK ("amount" >= 0);
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "price_entry" ADD CONSTRAINT "price_entry_not_self_chk" CHECK ("supersedesId" IS NULL OR "supersedesId" <> "id");
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_markup_chk" CHECK ("markup" >= 0 AND "markupMax" <= 0.45 AND "markup" <= "markupMax");
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_uplift_chk" CHECK ("webUplift" >= 0 AND "webUplift" <= 1);
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_limits_chk" CHECK ("minOffersForMedian" BETWEEN 1 AND 20 AND "offerMaxAgeDays" BETWEEN 1 AND 3650);
ALTER TABLE "market_offer" ADD CONSTRAINT "market_offer_price_chk" CHECK ("price" > 0 AND ("shipping" IS NULL OR "shipping" >= 0));
ALTER TABLE "market_offer" ADD CONSTRAINT "market_offer_url_chk" CHECK ("url" ~ '^https?://');
ALTER TABLE "market_offer" ADD CONSTRAINT "market_offer_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "research_asset" ADD CONSTRAINT "research_asset_url_chk" CHECK ("url" ~ '^https?://');
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_budget_chk" CHECK ("maxApiCalls" >= 0 AND "maxCostCents" >= 0 AND "apiCalls" >= 0 AND "costCents" >= 0);
ALTER TABLE "job" ADD CONSTRAINT "job_attempts_chk" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10);
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_number_chk" CHECK ("rowNumber" >= 1);
