import type { OfferCondition, ResearchAssetKind, SourceType } from "@/generated/prisma/enums";

export type ResearchProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  officialPages: string[];
};

export type AssetCandidate = {
  kind: ResearchAssetKind;
  url: string;
  sourceType: SourceType;
  sourceName: string;
  title?: string;
  data?: Record<string, unknown>;
};

export type OfferCandidate = {
  provider: string;
  sourceName: string;
  url: string;
  title: string;
  price: string;
  shipping?: string | null;
  currency: string;
  condition: OfferCondition;
};

export type ProviderResult = {
  assets: AssetCandidate[];
  offers: OfferCandidate[];
  fields?: { manufacturer?: string; model?: string };
  notes: string[];
  paidCalls: number;
};

export interface ResearchProvider {
  id: string;
  label: string;
  /** Pago? Se sim, cada chamada consome orçamento da execução. */
  paid: boolean;
  costPerCallCents(): number;
  configured(): boolean;
  /** Quantas chamadas pagas este provedor fará para o produto (para reservar orçamento). */
  plannedCalls(p: ResearchProduct): number;
  run(p: ResearchProduct): Promise<ProviderResult>;
}

export const officialDomains = () =>
  (process.env.RESEARCH_OFFICIAL_DOMAINS || "intelbras.com,backend.intelbras.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

export function isOfficialUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return officialDomains().some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
