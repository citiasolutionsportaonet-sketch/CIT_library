import "server-only";
import { imageMatchesModel } from "../match";
import { isOfficialUrl, type ProviderResult, type ResearchProduct, type ResearchProvider } from "./types";

// Brave Image Search (mesma chave BRAVE_SEARCH_API_KEY). Por padrão só aceita
// imagens HOSPEDADAS em domínio oficial (RESEARCH_OFFICIAL_DOMAINS) e cujo
// título/página/arquivo contenha os termos numéricos do modelo.
type ImageResult = { title?: string; url?: string; source?: string; properties?: { url?: string; width?: number; height?: number } };

export const braveImagesProvider: ResearchProvider = {
  id: "brave-images",
  label: "Brave Search API — imagens",
  paid: true,
  costPerCallCents: () => Number(process.env.BRAVE_COST_CENTS_PER_CALL ?? 3),
  configured: () => !!process.env.BRAVE_SEARCH_API_KEY,
  plannedCalls: (p) => (p.model ? 1 : 0),
  async run(p: ResearchProduct): Promise<ProviderResult> {
    const out: ProviderResult = { assets: [], offers: [], notes: [], paidCalls: 0 };
    if (!p.model) {
      out.notes.push("Brave Imagens: produto sem modelo/sugestão; busca não feita (evita imagens erradas).");
      return out;
    }
    const q = `${p.brand ?? ""} ${p.model}`.trim();
    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    url.search = new URLSearchParams({ q, country: "BR", search_lang: "pt-br", count: "20", safesearch: "strict" }).toString();
    out.paidCalls = 1;
    const res = await fetch(url, { headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY! }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) throw Object.assign(new Error("Brave: limite de requisições"), { retryAfter: 60 });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Brave recusou a chave (HTTP ${res.status}).`), { retryable: false });
    if (!res.ok) throw new Error(`Brave Imagens respondeu ${res.status}`);
    const data = (await res.json()) as { results?: ImageResult[] };
    const officialOnly = process.env.RESEARCH_IMAGES_OFFICIAL_ONLY !== "false";
    let skippedOther = 0;
    let skippedModel = 0;
    for (const r of data.results ?? []) {
      const img = r.properties?.url;
      if (!img || !/^https?:\/\//.test(img)) continue;
      const official = isOfficialUrl(img);
      if (officialOnly && !official) {
        skippedOther++;
        continue;
      }
      if (!imageMatchesModel(p.model, [r.title, r.url, img])) {
        skippedModel++;
        continue;
      }
      out.assets.push({
        kind: "IMAGE",
        url: img,
        sourceType: official ? "OFFICIAL" : "OTHER",
        sourceName: new URL(img).hostname,
        title: r.title?.slice(0, 200),
        data: { page: r.url ?? null, provider: "brave-images", query: q },
      });
      if (out.assets.length >= 6) break;
    }
    if (out.assets.length === 0) out.notes.push(`Brave Imagens: nenhuma imagem oficial do modelo "${p.model}" (${skippedOther} de outros sites, ${skippedModel} de outro modelo).`);
    return out;
  },
};
