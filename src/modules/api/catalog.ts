import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeCode } from "@/lib/normalize";
import { computePricing, Decimal, type Money } from "@/modules/pricing/calc";
import { COST_LIST_NAME, currentPrices, getPricingConfig } from "@/modules/pricing/service";
import { currentAcceptedOffers } from "@/modules/pricing/offers";
import { normalizeName } from "@/lib/normalize";
import { getDb } from "@/server/db";
import { notFound, validation } from "@/server/errors";
import type { ApiPrincipal } from "./credentials";

// Projeções da API v1: decimais como string; custo só com costs:read;
// notas internas nunca saem pela API.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function pricingMap(p: ApiPrincipal, ids: string[]) {
  const db = getDb();
  const cfg = await getPricingConfig(p.tenantId);
  const list = await db.priceList.findUnique({ where: { tenantId_normalizedName: { tenantId: p.tenantId, normalizedName: normalizeName(COST_LIST_NAME) } } });
  const costs = list ? await currentPrices(p.tenantId, list.id, ids) : new Map<string, Money>();
  const offers = await currentAcceptedOffers(p.tenantId, ids, cfg.offerMaxAgeDays);
  const by = new Map<string, Money[]>();
  for (const o of offers) by.set(o.productId, [...(by.get(o.productId) ?? []), new Decimal(o.price.toString())]);
  const out = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const c = costs.get(id);
    const r = computePricing(c && c.greaterThan(0) ? c : null, by.get(id) ?? [], cfg);
    out.set(id, {
      currency: "BRL",
      citPrice: r.citPrice?.toFixed(2) ?? null,
      market: {
        median: r.marketMedian?.toFixed(2) ?? null,
        acceptedOffers: r.marketCount,
        sufficient: r.marketSufficient,
        // Referência comercial calculada (mediana × 1,15). NÃO é preço anunciado.
        commercialReference: r.webReference?.toFixed(2) ?? null,
        commercialReferenceNote: "Mediana de ofertas online aceitas acrescida do ajuste comercial; não é um preço anunciado.",
      },
      citVsMarket: { difference: r.diffAbs?.toFixed(2) ?? null, percent: r.diffPct?.toFixed(1) ?? null },
      ...(p.scopes.has("costs:read") ? { distributorCost: r.cost?.toFixed(2) ?? null, markupPercent: r.markup.times(100).toFixed(2) } : {}),
    });
  }
  return out;
}

export async function apiListProducts(p: ApiPrincipal, url: URL) {
  const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page") ?? 1) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") ?? 50) || 50));
  const q = url.searchParams.get("q")?.trim().slice(0, 120);
  const sku = url.searchParams.get("sku")?.trim().slice(0, 80);
  const status = url.searchParams.get("status");
  if (status && !["DRAFT", "ACTIVE"].includes(status)) throw validation({ status: "Use DRAFT ou ACTIVE." });
  const where: Prisma.ProductWhereInput = { tenantId: p.tenantId, status: status ? (status as "DRAFT" | "ACTIVE") : { not: "ARCHIVED" } };
  if (sku) where.normalizedSku = normalizeCode(sku);
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { normalizedSku: { contains: normalizeCode(q) } }, { model: { contains: q, mode: "insensitive" } }];
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy: [{ normalizedSku: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { brand: { select: { name: true } }, category: { select: { name: true } } } }),
  ]);
  const prices = p.scopes.has("prices:read") ? await pricingMap(p, rows.map((r) => r.id)) : null;
  return {
    data: rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      brand: r.brand?.name ?? null,
      model: r.model,
      category: r.category?.name ?? null,
      status: r.status,
      coverImage: r.coverMediaId ? `/api/v1/media/${r.coverMediaId}` : null,
      updatedAt: r.updatedAt.toISOString(),
      ...(prices ? { pricing: prices.get(r.id) } : {}),
    })),
    page,
    pageSize,
    total,
  };
}

export async function apiGetProduct(p: ApiPrincipal, id: string) {
  if (!UUID.test(id)) throw notFound("Produto");
  const db = getDb();
  const r = await db.product.findFirst({
    where: { id, tenantId: p.tenantId, status: { not: "ARCHIVED" } },
    include: {
      brand: { select: { name: true } },
      category: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
      media: { where: { media: { state: "READY" } }, orderBy: [{ position: "asc" }, { mediaId: "asc" }], select: { mediaId: true, altText: true } },
      researchAssets: { where: { status: "ACCEPTED", kind: { in: ["DATASHEET", "MANUAL", "OFFICIAL_PAGE"] } }, select: { kind: true, url: true, sourceName: true, title: true } },
    },
  });
  if (!r) throw notFound("Produto");
  const prices = p.scopes.has("prices:read") ? await pricingMap(p, [r.id]) : null;
  return {
    data: {
      id: r.id,
      sku: r.sku,
      name: r.name,
      description: r.description,
      brand: r.brand?.name ?? null,
      model: r.model,
      manufacturerCode: r.manufacturerCode,
      gtin: r.gtin,
      unit: r.unit,
      category: r.category?.name ?? null,
      tags: r.tags.map((t) => t.tag.name),
      status: r.status,
      specs: r.specs,
      links: r.links,
      images: r.media.map((m) => ({ url: `/api/v1/media/${m.mediaId}`, thumbnailUrl: `/api/v1/media/${m.mediaId}?v=thumb`, alt: m.altText, cover: m.mediaId === r.coverMediaId })),
      documents: r.researchAssets.map((a) => ({ type: a.kind, url: a.url, source: a.sourceName, title: a.title })),
      updatedAt: r.updatedAt.toISOString(),
      ...(prices ? { pricing: prices.get(r.id) } : {}),
    },
  };
}

export async function apiProductPrices(p: ApiPrincipal, id: string) {
  if (!UUID.test(id)) throw notFound("Produto");
  const exists = await getDb().product.findFirst({ where: { id, tenantId: p.tenantId }, select: { id: true } });
  if (!exists) throw notFound("Produto");
  const pricing = (await pricingMap(p, [id])).get(id);
  const cfg = await getPricingConfig(p.tenantId);
  const offers = (await currentAcceptedOffers(p.tenantId, [id], cfg.offerMaxAgeDays)).slice(0, 50);
  return {
    data: {
      pricing,
      quotes: offers.map((o) => ({ source: o.sourceName, provider: o.provider, url: o.url, price: o.price.toFixed(2), shipping: o.shipping?.toFixed(2) ?? null, currency: o.currency, condition: o.condition, observedAt: o.observedAt.toISOString() })),
    },
  };
}
