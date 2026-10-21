import "server-only";
import { politeFetch } from "../http";
import { tokens } from "../match";
import { type AssetCandidate, isOfficialUrl, type ProviderResult, type ResearchProduct, type ResearchProvider } from "./types";

const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Extrai dados de uma página de produto (HTML) sem executar scripts. */
export function extractFromHtml(html: string, pageUrl: string, model: string | null) {
  const abs = (u: string) => {
    try {
      return new URL(decode(u), pageUrl).toString();
    } catch {
      return null;
    }
  };
  const images: string[] = [];
  const docs: { url: string; label: string }[] = [];
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    const content = attr(m[0], "content");
    if (!content) continue;
    if (prop === "og:image" || prop === "og:image:secure_url") images.push(abs(content) ?? "");
    if (prop === "og:title") fields.title = decode(content).slice(0, 200);
  }
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      for (const node of [data, ...(Array.isArray(data?.["@graph"]) ? data["@graph"] : [])].flat()) {
        if (!node || !/Product/i.test(String(node["@type"] ?? ""))) continue;
        for (const img of [node.image].flat().filter(Boolean)) images.push(abs(typeof img === "string" ? img : img?.url ?? "") ?? "");
        if (node.brand) fields.manufacturer = String(node.brand?.name ?? node.brand).slice(0, 120);
        if (node.model || node.mpn) fields.model = String(node.model ?? node.mpn).slice(0, 120);
        if (node.name) fields.title = String(node.name).slice(0, 200);
      }
    } catch {
      /* JSON-LD inválido: ignorado */
    }
  }
  const modelTokens = tokens(model ?? "");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], "src") ?? attr(m[0], "data-src");
    const alt = attr(m[0], "alt") ?? "";
    if (!src || /logo|icon|sprite|banner|\.svg/i.test(src)) continue;
    const t = new Set(tokens(`${alt} ${src}`));
    if (modelTokens.length && modelTokens.filter((x) => /\d/.test(x)).every((x) => t.has(x))) images.push(abs(src) ?? "");
  }
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = abs(m[1]);
    const label = decode(m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 150);
    if (href && /\.pdf(\?|$)/i.test(href)) docs.push({ url: href, label });
  }
  const uniq = <T,>(a: T[], key: (x: T) => string) => [...new Map(a.map((x) => [key(x), x])).values()];
  return {
    images: uniq(images.filter((u) => /^https?:\/\//.test(u)), (u) => u),
    docs: uniq(docs, (d) => d.url),
    fields,
  };
}

export const officialSiteProvider: ResearchProvider = {
  id: "official-site",
  label: "Site oficial do fabricante",
  paid: false,
  costPerCallCents: () => 0,
  configured: () => true,
  plannedCalls: () => 0,
  async run(p: ResearchProduct): Promise<ProviderResult> {
    const out: ProviderResult = { assets: [], offers: [], notes: [], paidCalls: 0 };
    for (const page of p.officialPages.filter(isOfficialUrl).slice(0, 3)) {
      try {
        const res = await politeFetch(page);
        if (res.status !== 200 || !/html/i.test(res.contentType)) {
          out.notes.push(`Página oficial respondeu ${res.status} (${page})`);
          continue;
        }
        const host = new URL(res.url).hostname;
        const x = extractFromHtml(res.body.toString("utf8"), res.url, p.model);
        out.assets.push({ kind: "OFFICIAL_PAGE", url: res.url, sourceType: "OFFICIAL", sourceName: host, title: x.fields.title });
        for (const img of x.images.slice(0, 6)) out.assets.push({ kind: "IMAGE", url: img, sourceType: isOfficialUrl(img) ? "OFFICIAL" : "OTHER", sourceName: new URL(img).hostname });
        for (const d of x.docs.slice(0, 10)) {
          const kind = /manual|guia|instala/i.test(`${d.label} ${d.url}`) ? "MANUAL" : "DATASHEET";
          out.assets.push({ kind, url: d.url, sourceType: isOfficialUrl(d.url) ? "OFFICIAL" : "OTHER", sourceName: new URL(d.url).hostname, title: d.label || undefined } satisfies AssetCandidate);
        }
        if (x.fields.manufacturer || x.fields.model) out.fields = { manufacturer: x.fields.manufacturer, model: x.fields.model };
      } catch (e) {
        out.notes.push(`Falha ao ler ${page}: ${(e as Error).message}`);
      }
    }
    if (p.officialPages.length === 0) out.notes.push("Sem página oficial conhecida (configure um provedor de busca para descobrir).");
    return out;
  },
};
