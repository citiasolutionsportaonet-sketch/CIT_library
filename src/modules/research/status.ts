import "server-only";
import type { Prisma, ResearchStatus } from "@/generated/prisma/client";

/** Máximo de imagens vindas da pesquisa por produto. */
export const MAX_IMAGES_PER_PRODUCT = 3;

/**
 * Situação de pesquisa do produto a partir de TODAS as evidências (motor,
 * planilha preliminar ou manual): pendente de revisão > aprovado > sem dados.
 */
export async function computeResearchStatus(tx: Prisma.TransactionClient, tenantId: string, productId: string): Promise<ResearchStatus> {
  const pending =
    (await tx.marketOffer.count({ where: { tenantId, productId, status: "CANDIDATE" } })) +
    (await tx.researchAsset.count({ where: { tenantId, productId, status: "CANDIDATE", kind: { not: "OFFICIAL_PAGE" } } }));
  if (pending > 0) return "NEEDS_REVIEW";
  const accepted =
    (await tx.marketOffer.count({ where: { tenantId, productId, status: "ACCEPTED" } })) +
    (await tx.researchAsset.count({ where: { tenantId, productId, status: "ACCEPTED" } }));
  return accepted > 0 ? "ENRICHED" : "NO_DATA";
}
