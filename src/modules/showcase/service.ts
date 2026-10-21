import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeName } from "@/lib/normalize";
import { pricingFor, COST_LIST_NAME } from "@/modules/pricing/service";
import {
  buildProductWhere,
  withSubcategories,
} from "@/modules/products/service";
import { assertCan, type TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { showcaseSchema, type ShowcaseData } from "./schema";

export async function loadShowcase(
  ctx: TenantContext,
  input: Partial<ShowcaseData["filters"]> & { page?: number } = {},
): Promise<ShowcaseData> {
  assertCan(ctx, "catalog:read");
  const filters = {
    q: (input.q ?? "").trim().slice(0, 120),
    category: input.category ?? "",
    brand: input.brand ?? "",
    photo: input.photo === true,
    sort: input.sort ?? "destaques",
  };
  const db = getDb();
  const where = buildProductWhere(
    ctx,
    await withSubcategories(ctx, {
      q: filters.q,
      categoryId: filters.category,
      brandId: filters.brand,
    }),
  );
  if (filters.photo) where.coverMediaId = { not: null };
  const base = { tenantId: ctx.tenantId, status: { not: "ARCHIVED" as const } };
  const [totals, categories, brands, groups, total] = await Promise.all([
    db.$queryRaw<(ShowcaseData["stats"] & { updatedAt: Date | null })[]>`
      WITH latest_cost AS (
        SELECT DISTINCT ON (e."productId") e."productId", e."amount"
        FROM "price_entry" e JOIN "price_list" l ON l."id" = e."priceListId" AND l."tenantId" = e."tenantId"
        WHERE e."tenantId" = ${ctx.tenantId}::uuid AND l."normalizedName" = ${normalizeName(COST_LIST_NAME)} AND e."effectiveAt" <= now()
        ORDER BY e."productId", e."effectiveAt" DESC, e."recordedAt" DESC, e."id" DESC
      )
      SELECT count(*)::int AS "total",
        count(*) FILTER (WHERE p."coverMediaId" IS NOT NULL)::int AS "withPhoto",
        count(*) FILTER (WHERE c."amount" > 0)::int AS "withPrice",
        count(*) FILTER (WHERE p."brandId" IS NOT NULL)::int AS "withBrand",
        count(*) FILTER (WHERE p."model" IS NOT NULL AND p."model" <> '')::int AS "withModel",
        count(*) FILTER (WHERE p."status" = 'ACTIVE')::int AS "active",
        count(*) FILTER (WHERE p."status" = 'DRAFT')::int AS "drafts", max(p."updatedAt") AS "updatedAt"
      FROM "product" p LEFT JOIN latest_cost c ON c."productId" = p."id"
      WHERE p."tenantId" = ${ctx.tenantId}::uuid AND p."status" <> 'ARCHIVED'`,
    db.category.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.brand.findMany({
      where: { tenantId: ctx.tenantId, active: true },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.product.groupBy({
      by: ["categoryId"],
      where: base,
      _count: { _all: true },
    }),
    db.product.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / 24));
  const page = Math.max(
    1,
    Math.min(pageCount, Math.floor(Number(input.page) || 1)),
  );
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    filters.sort === "nome"
      ? [{ name: "asc" }, { id: "asc" }]
      : filters.sort === "recentes"
        ? [{ updatedAt: "desc" }, { id: "asc" }]
        : [
            { coverMediaId: { sort: "asc", nulls: "last" } },
            { name: "asc" },
            { id: "asc" },
          ];
  const rows = await db.product.findMany({
    where,
    orderBy,
    skip: (page - 1) * 24,
    take: 24,
    select: {
      id: true,
      sku: true,
      name: true,
      model: true,
      status: true,
      coverMediaId: true,
      brandId: true,
      categoryId: true,
      updatedAt: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  const prices = await pricingFor(
    ctx,
    rows.map((p) => p.id),
    { forceHideCost: true },
  );
  const counts = new Map(groups.map((g) => [g.categoryId, g._count._all]));
  const summary = totals[0];
  return showcaseSchema.parse({
    organization: ctx.tenantName,
    generatedAt: new Date().toISOString(),
    updatedAt: summary.updatedAt?.toISOString() ?? null,
    stats: summary,
    categories: [
      ...categories.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })),
      { id: "none", name: "Sem categoria", count: counts.get(null) ?? 0 },
    ],
    brands,
    products: rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand?.name ?? null,
      brandId: p.brandId,
      category: p.category?.name ?? null,
      categoryId: p.categoryId,
      model: p.model,
      price: prices.get(p.id)?.citPrice ?? null,
      image: p.coverMediaId ? `/api/media/${p.coverMediaId}?v=thumb` : null,
      status: p.status,
      updatedAt: p.updatedAt.toISOString(),
    })),
    total,
    page,
    pageCount,
    filters,
  });
}
