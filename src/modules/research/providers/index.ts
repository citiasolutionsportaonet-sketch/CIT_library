import { braveProvider } from "./brave";
import { braveImagesProvider } from "./brave-images";
import { mercadoLivreProvider } from "./mercadolivre";
import { officialSiteProvider } from "./official-site";
import type { ResearchProvider } from "./types";

/** Ordem de prioridade: oficial → imagens licenciadas → busca licenciada → marketplace oficial. */
export const PROVIDERS: ResearchProvider[] = [officialSiteProvider, braveImagesProvider, braveProvider, mercadoLivreProvider];

export function providerStatus() {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, paid: p.paid, configured: p.configured(), costPerCallCents: p.costPerCallCents() }));
}
