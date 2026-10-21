import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeName } from "@/lib/normalize";
import { audit } from "@/server/audit";
import { assertCan, can, type TenantContext } from "@/server/authorize";
import { getDb, type Tx } from "@/server/db";
import { DomainError, notFound, validation } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { computePricing, Decimal, type Money, type PricingResult } from "./calc";
import { currentAcceptedOffers } from "./offers";

export const COST_LIST_NAME = "Custo distribuidor";
export const MARKUP_CEILING = new Decimal("0.45");

export async function getPricingConfig(tenantId: string, db: Tx | ReturnType<typeof getDb> = getDb()) {
  const c = await db.pricingConfig.findUnique({ where: { tenantId } });
  return {
    markup: c ? new Decimal(c.markup.toString()) : new Decimal("0.45"),
    markupMax: c ? new Decimal(c.markupMax.toString()) : MARKUP_CEILING,
    webUplift: c ? new Decimal(c.webUplift.toString()) : new Decimal("0.15"),
    minOffersForMedian: c?.minOffersForMedian ?? 3,
    offerMaxAgeDays: c?.offerMaxAgeDays ?? 90,
    updatedAt: c?.updatedAt ?? null,
  };
}

export async function updateMarkup(ctx: TenantContext, rawPercent: unknown) {
  assertCan(ctx, "pricing:configure");
  const pct = Number(String(rawPercent ?? "").replace(",", "."));
  if (!Number.isFinite(pct) || pct < 0 || pct > 45) throw validation({ markup: "Informe um markup entre 0% e 45%." });
  const markup = new Decimal(pct).dividedBy(100).toDecimalPlaces(4);
  await writeTx(async (tx) => {
    const before = await getPricingConfig(ctx.tenantId, tx);
    await tx.pricingConfig.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, markup: markup.toString(), updatedById: ctx.userId },
      update: { markup: markup.toString(), updatedById: ctx.userId },
    });
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId,
      action: "pricing.markup",
      entityType: "PricingConfig",
      entityId: ctx.tenantId,
      diff: { de: before.markup.toString(), para: markup.toString() },
    });
  });
}

/** Garante a lista de custo do distribuidor (idempotente). */
export async function ensureCostList(tx: Tx, tenantId: string, supplier: string) {
  return tx.priceList.upsert({
    where: { tenantId_normalizedName: { tenantId, normalizedName: normalizeName(COST_LIST_NAME) } },
    create: { tenantId, name: COST_LIST_NAME, normalizedName: normalizeName(COST_LIST_NAME), supplier, currency: "BRL", kind: "COST" },
    update: {},
  });
}

/**
 * Preço vigente por produto numa lista: maior effectiveAt <= instante,
 * desempate por recordedAt e id (nunca pela ordem natural do banco).
 */
export async function currentPrices(tenantId: string, priceListId: string, productIds: string[], at = new Date()) {
  if (productIds.length === 0) return new Map<string, Money>();
  const rows = await getDb().$queryRaw<{ productId: string; amount: Prisma.Decimal }[]>`
    SELECT DISTINCT ON ("productId") "productId", "amount"
    FROM "price_entry"
    WHERE "tenantId" = ${tenantId}::uuid AND "priceListId" = ${priceListId}::uuid
      AND "productId" = ANY(${productIds}::uuid[]) AND "effectiveAt" <= ${at}
    ORDER BY "productId", "effectiveAt" DESC, "recordedAt" DESC, "id" DESC`;
  return new Map(rows.map((r) => [r.productId, new Decimal(r.amount.toString())]));
}

export type PricingView = Omit<PricingResult, "cost" | "markup"> & {
  cost: string | null;
  markupPct: string | null;
  citPrice: string | null;
};

function serialize(r: PricingResult, includeCost: boolean) {
  return {
    cost: includeCost && r.cost ? r.cost.toFixed(2) : null,
    markupPct: includeCost ? r.markup.times(100).toFixed(2) : null,
    citPrice: r.citPrice?.toFixed(2) ?? null,
    marketMedian: r.marketMedian?.toFixed(2) ?? null,
    marketCount: r.marketCount,
    marketSufficient: r.marketSufficient,
    webReference: r.webReference?.toFixed(2) ?? null,
    diffAbs: r.diffAbs?.toFixed(2) ?? null,
    diffPct: r.diffPct?.toFixed(1) ?? null,
  };
}

/** Preços de vários produtos. Custo só é incluído com costs:read. */
export async function pricingFor(ctx: TenantContext, productIds: string[], opts: { forceHideCost?: boolean } = {}) {
  assertCan(ctx, "catalog:read");
  const db = getDb();
  const cfg = await getPricingConfig(ctx.tenantId);
  const list = await db.priceList.findUnique({ where: { tenantId_normalizedName: { tenantId: ctx.tenantId, normalizedName: normalizeName(COST_LIST_NAME) } } });
  const costs = list ? await currentPrices(ctx.tenantId, list.id, productIds) : new Map<string, Money>();
  const offers = await currentAcceptedOffers(ctx.tenantId, productIds, cfg.offerMaxAgeDays);
  const byProduct = new Map<string, Money[]>();
  for (const o of offers) {
    const a = byProduct.get(o.productId) ?? [];
    a.push(new Decimal(o.price.toString()));
    byProduct.set(o.productId, a);
  }
  const includeCost = can(ctx, "costs:read") && !opts.forceHideCost;
  const out = new Map<string, ReturnType<typeof serialize>>();
  for (const id of productIds) {
    const cost = costs.get(id) ?? null;
    out.set(id, serialize(computePricing(cost && cost.greaterThan(0) ? cost : null, byProduct.get(id) ?? [], cfg), includeCost));
  }
  return out;
}

/** Histórico do custo (somente quem pode ver custos). */
export async function costHistory(ctx: TenantContext, productId: string) {
  assertCan(ctx, "costs:read");
  const rows = await getDb().priceEntry.findMany({
    where: { tenantId: ctx.tenantId, productId, priceList: { kind: "COST" } },
    orderBy: [{ effectiveAt: "desc" }, { recordedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, amount: true, currency: true, effectiveAt: true, recordedAt: true, source: true, reason: true, importRowId: true, supersedesId: true },
  });
  return rows.map((r) => ({ ...r, amount: r.amount.toFixed(2) }));
}

/** Correção manual de custo: nova entrada com referência de substituição. */
export async function recordCost(ctx: TenantContext, productId: string, amount: Money, effectiveAt: Date, reason: string, supersedesId?: string) {
  assertCan(ctx, "prices:write");
  if (amount.isNegative()) throw validation({ amount: "Valor negativo não é permitido." });
  if (!reason.trim()) throw validation({ reason: "Informe o motivo." });
  await writeTx(async (tx) => {
    const p = await tx.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!p) throw notFound("Produto");
    const list = await ensureCostList(tx, ctx.tenantId, "Distribuidor");
    if (supersedesId) {
      const prev = await tx.priceEntry.findFirst({ where: { id: supersedesId, tenantId: ctx.tenantId, productId } });
      if (!prev) throw new DomainError("CONFLICT", "Entrada substituída não pertence a este produto.");
    }
    const e = await tx.priceEntry.create({
      data: { tenantId: ctx.tenantId, productId, priceListId: list.id, amount: amount.toString(), effectiveAt, source: "MANUAL", reason: reason.trim().slice(0, 500), supersedesId: supersedesId ?? null, createdById: ctx.userId },
    });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "price.cost.record", entityType: "Product", entityId: productId, diff: { entryId: e.id, amount: amount.toFixed(2), effectiveAt: effectiveAt.toISOString(), reason, supersedesId } });
  });
}
