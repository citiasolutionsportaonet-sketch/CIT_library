import "server-only";
import type { MarketOffer } from "@/generated/prisma/client";
import { getDb } from "@/server/db";

type CurrentOffer = Pick<MarketOffer, "id" | "productId" | "sourceName" | "url" | "price" | "shipping" | "currency" | "condition" | "observedAt" | "provider">;

/**
 * Uma URL de anúncio conta uma vez por produto, mesmo descoberta por provedores
 * diferentes. Mantém o histórico; apenas a observação vigente entra no cálculo.
 * O status é filtrado DEPOIS de escolher a mais recente: uma rejeição ou revisão
 * pendente não pode ressuscitar o preço aceito de uma observação anterior.
 */
export async function currentAcceptedOffers(tenantId: string, productIds: string[], maxAgeDays: number, at = new Date()): Promise<CurrentOffer[]> {
  if (productIds.length === 0) return [];
  const since = new Date(at.getTime() - maxAgeDays * 86400_000);
  return getDb().$queryRaw<CurrentOffer[]>`
    SELECT "id", "productId", "sourceName", "url", "price", "shipping",
      "currency", "condition", "observedAt", "provider"
    FROM (
      SELECT DISTINCT ON ("productId", "url")
        "id", "productId", "sourceName", "url", "price", "shipping", "currency",
        "condition", "observedAt", "provider", "status", "isListingPage"
      FROM "market_offer"
      WHERE "tenantId" = ${tenantId}::uuid AND "productId" = ANY(${productIds}::uuid[])
        AND "observedAt" >= ${since} AND "observedAt" <= ${at}
      ORDER BY "productId", "url", "observedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS latest
    WHERE "status" = 'ACCEPTED' AND "isListingPage" = false
    ORDER BY "observedAt" DESC, "id" ASC`;
}
