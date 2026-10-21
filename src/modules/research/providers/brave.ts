import "server-only";
import { type ProviderResult, type ResearchProduct, type ResearchProvider, isOfficialUrl, officialDomains } from "./types";

// Brave Search API (licenciada, chave em BRAVE_SEARCH_API_KEY).
// Usada para DESCOBRIR página oficial e PDFs; não fornece preços.
export const braveProvider: ResearchProvider = {
  id: "brave-search",
  label: "Brave Search API",
  paid: true,
  costPerCallCents: () => Number(process.env.BRAVE_COST_CENTS_PER_CALL ?? 3),
  configured: () => !!process.env.BRAVE_SEARCH_API_KEY,
  plannedCalls: () => 1,
  async run(p: ResearchProduct): Promise<ProviderResult> {
    const out: ProviderResult = { assets: [], offers: [], notes: [], paidCalls: 0 };
    const term = p.model ? `"${p.model}"` : p.name;
    const q = `${term} ${p.brand ?? ""} ${officialDomains().map((d) => `site:${d}`).join(" OR ")}`.trim();
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({ q, country: "BR", search_lang: "pt-br", count: "8", safesearch: "strict" }).toString();
    out.paidCalls = 1;
    const res = await fetch(url, { headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY! }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) throw Object.assign(new Error("Brave: limite de requisições"), { retryAfter: 60 });
    if (!res.ok) throw new Error(`Brave respondeu ${res.status}`);
    const data = (await res.json()) as { web?: { results?: { url: string; title: string }[] } };
    for (const r of data.web?.results ?? []) {
      if (!isOfficialUrl(r.url)) continue;
      const kind = /\.pdf(\?|$)/i.test(r.url) ? (/manual|guia/i.test(r.title) ? "MANUAL" : "DATASHEET") : "OFFICIAL_PAGE";
      out.assets.push({ kind, url: r.url, sourceType: "OFFICIAL", sourceName: new URL(r.url).hostname, title: r.title?.slice(0, 200) });
    }
    if (out.assets.length === 0) out.notes.push(`Brave: nenhum resultado oficial para ${q}`);
    return out;
  },
};
