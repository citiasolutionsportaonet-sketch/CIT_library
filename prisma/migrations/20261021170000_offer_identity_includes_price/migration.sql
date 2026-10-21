-- DropIndex
DROP INDEX "market_offer_tenantId_productId_provider_url_observedAt_key";

-- CreateIndex
CREATE UNIQUE INDEX "market_offer_tenantId_productId_provider_url_observedAt_pri_key" ON "market_offer"("tenantId", "productId", "provider", "url", "observedAt", "price");

