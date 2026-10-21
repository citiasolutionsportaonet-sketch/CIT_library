import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductStatus, ResearchStatus } from "@/generated/prisma/enums";
import { normalizeCode, normalizeName } from "@/lib/normalize";
import { audit, shallowDiff } from "@/server/audit";
import { getDb, type Tx } from "@/server/db";
import { DomainError, notFound, uniqueViolationTarget, validation } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { assertCan, can, type TenantContext } from "@/server/authorize";
import { type Link, type ProductInput, productInputSchema, type Spec, zodFieldErrors } from "./schema";

export const PAGE_SIZES = [24, 48, 96] as const;
export const SORTS = ["recentes", "nome", "sku"] as const;
export type Sort = (typeof SORTS)[number];

export type ListParams = {
  q?: string;
  /** UUID ou "none" (sem marca). */
  brandId?: string;
  /** UUID ou "none" (sem categoria). */
  categoryId?: string;
  /** Preenchido por withSubcategories: a categoria e todas as descendentes. */
  categoryIds?: string[];
  tagId?: string;
  status?: ProductStatus | "ALL";
  researchStatus?: ResearchStatus;
  sort?: Sort;
  page?: number;
  pageSize?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | undefined): v is string => !!v && UUID.test(v);

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Expande o filtro de categoria para incluir subcategorias (CTE recursiva). */
export async function withSubcategories(ctx: TenantContext, params: ListParams): Promise<ListParams> {
  if (!isUuid(params.categoryId)) return params;
  const rows = await getDb().$queryRaw<{ id: string }[]>`
    WITH RECURSIVE t AS (
      SELECT "id" FROM "category" WHERE "id" = ${params.categoryId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid
      UNION SELECT c."id" FROM "category" c JOIN t ON c."parentId" = t."id" WHERE c."tenantId" = ${ctx.tenantId}::uuid
    ) SELECT "id" FROM t`;
  return { ...params, categoryIds: rows.map((r) => r.id) };
}

/** Filtro do catálogo, compartilhado por listagem, edição em massa e exportação. */
export function buildProductWhere(ctx: TenantContext, params: ListParams): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { tenantId: ctx.tenantId };
  if (!params.status) where.status = { not: "ARCHIVED" };
  else if (params.status !== "ALL") where.status = params.status;
  if (isUuid(params.brandId)) where.brandId = params.brandId;
  if (params.categoryId === "none") where.categoryId = null;
  else if (params.categoryIds?.length) where.categoryId = { in: params.categoryIds };
  else if (isUuid(params.categoryId)) where.categoryId = params.categoryId;
  if (params.brandId === "none") where.brandId = null;
  if (params.researchStatus) where.researchStatus = params.researchStatus;
  if (isUuid(params.tagId)) where.tags = { some: { tagId: params.tagId, tenantId: ctx.tenantId } };
  const q = params.q?.trim().slice(0, 120);
  if (q) {
    const code = normalizeCode(q);
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { normalizedSku: { contains: code } },
      { model: { contains: q, mode: "insensitive" } },
      { normalizedManufacturerCode: { contains: code } },
    ];
  }
  return where;
}

export async function listProducts(ctx: TenantContext, params: ListParams) {
  assertCan(ctx, "catalog:read");
  const pageSize = PAGE_SIZES.includes(params.pageSize as (typeof PAGE_SIZES)[number]) ? params.pageSize! : PAGE_SIZES[0];
  const page = Math.max(1, Math.min(10_000, Math.floor(params.page ?? 1)));
  const where = buildProductWhere(ctx, await withSubcategories(ctx, params));

  // Ordenação estável: sempre desempata por id.
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    params.sort === "nome"
      ? [{ name: "asc" }, { id: "asc" }]
      : params.sort === "sku"
        ? [{ normalizedSku: "asc" }, { id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "desc" }];

  const db = getDb();
  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        sku: true,
        name: true,
        model: true,
        manufacturerCode: true,
        status: true,
        updatedAt: true,
        coverMediaId: true,
        researchStatus: true,
        brand: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
  ]);
  return { items: rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getFacets(ctx: TenantContext) {
  assertCan(ctx, "catalog:read");
  const db = getDb();
  const [brands, categories, tags] = await Promise.all([
    db.brand.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.category.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.tag.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  return { brands, categories, tags };
}

export async function getProduct(ctx: TenantContext, id: string) {
  assertCan(ctx, "catalog:read");
  if (!isUuid(id)) throw notFound("Produto");
  const db = getDb();
  const p = await db.product.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      tags: { select: { tag: { select: { id: true, name: true } } } },
      media: {
        where: { media: { state: "READY" } },
        orderBy: [{ position: "asc" }, { mediaId: "asc" }],
        select: { mediaId: true, position: true, altText: true, media: { select: { width: true, height: true, originalName: true, byteSize: true } } },
      },
    },
  });
  if (!p) throw notFound("Produto");
  const people = await db.user.findMany({ where: { id: { in: [p.createdById, p.updatedById] } }, select: { id: true, name: true } });
  const nameOf = (uid: string) => people.find((u) => u.id === uid)?.name ?? "Usuário removido";
  const canWrite = can(ctx, "products:write");
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category: p.category,
    model: p.model,
    manufacturerCode: p.manufacturerCode,
    gtin: p.gtin,
    description: p.description,
    unit: p.unit,
    status: p.status,
    specs: (p.specs ?? []) as Spec[],
    links: (p.links ?? []) as Link[],
    // Projeção no servidor: leitores não recebem notas internas.
    internalNotes: canWrite ? p.internalNotes : null,
    tags: p.tags.map((t) => t.tag).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    media: p.media.map((m) => ({ id: m.mediaId, position: m.position, altText: m.altText, ...m.media })),
    coverMediaId: p.coverMediaId,
    suggestedModel: p.suggestedModel,
    suggestedManufacturer: p.suggestedManufacturer,
    researchStatus: p.researchStatus,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    archivedAt: p.archivedAt,
    createdBy: nameOf(p.createdById),
    updatedBy: nameOf(p.updatedById),
  };
}

export type ProductDetail = Awaited<ReturnType<typeof getProduct>>;

/** Pendências exibidas ao usuário (não bloqueiam o rascunho). */
export function productPendencies(p: Pick<ProductDetail, "brand" | "model" | "media" | "status">): string[] {
  const out: string[] = [];
  if (!p.brand) out.push("Sem marca (obrigatória para ativar).");
  if (!p.model) out.push("Sem modelo (obrigatório para ativar).");
  if (p.media.length === 0) out.push("Sem foto (recomendada).");
  return out;
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export function parseProductInput(raw: unknown): ProductInput {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) throw validation(zodFieldErrors(parsed.error));
  return parsed.data;
}

async function resolveBrand(tx: Tx, tenantId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const normalizedName = normalizeName(name);
  const b = await tx.brand.upsert({
    where: { tenantId_normalizedName: { tenantId, normalizedName } },
    create: { tenantId, name, normalizedName },
    update: {},
    select: { id: true },
  });
  return b.id;
}

async function resolveCategory(tx: Tx, tenantId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const normalizedName = normalizeName(name);
  const c = await tx.category.upsert({
    where: { tenantId_normalizedName: { tenantId, normalizedName } },
    create: { tenantId, name, normalizedName },
    update: {},
    select: { id: true },
  });
  return c.id;
}

async function setTags(tx: Tx, tenantId: string, productId: string, names: string[]) {
  const unique = new Map<string, string>();
  for (const n of names) {
    const key = normalizeName(n);
    if (key && !unique.has(key)) unique.set(key, n);
  }
  const ids: string[] = [];
  for (const [normalizedName, name] of unique) {
    const t = await tx.tag.upsert({
      where: { tenantId_normalizedName: { tenantId, normalizedName } },
      create: { tenantId, name, normalizedName },
      update: {},
      select: { id: true },
    });
    ids.push(t.id);
  }
  await tx.productTag.deleteMany({ where: { tenantId, productId } });
  if (ids.length) await tx.productTag.createMany({ data: ids.map((tagId) => ({ tenantId, productId, tagId })) });
}

function scalarData(input: ProductInput) {
  return {
    sku: input.sku,
    normalizedSku: normalizeCode(input.sku),
    name: input.name,
    model: input.model,
    manufacturerCode: input.manufacturerCode,
    normalizedManufacturerCode: input.manufacturerCode ? normalizeCode(input.manufacturerCode) : null,
    gtin: input.gtin,
    description: input.description,
    unit: input.unit,
    status: input.status,
    specs: input.specs as Prisma.InputJsonValue,
    links: input.links as Prisma.InputJsonValue,
    internalNotes: input.internalNotes,
  };
}

function translateUnique(err: unknown): never {
  const target = uniqueViolationTarget(err);
  if (target) {
    if (target.some((f) => f.includes("normalizedSku"))) {
      throw new DomainError("CONFLICT", "Já existe um produto com este SKU nesta organização.", { sku: "SKU já utilizado por outro produto." });
    }
    if (target.some((f) => f.includes("normalizedManufacturerCode"))) {
      throw new DomainError("CONFLICT", "Já existe um produto desta marca com este código do fabricante.", {
        manufacturerCode: "Código já cadastrado para esta marca.",
      });
    }
    throw new DomainError("CONFLICT", "Registro duplicado.");
  }
  throw err;
}

const AUDIT_FIELDS = ["sku", "name", "brandId", "categoryId", "model", "manufacturerCode", "gtin", "description", "unit", "status", "specs", "links", "internalNotes"];

export async function createProduct(ctx: TenantContext, raw: unknown): Promise<{ id: string }> {
  assertCan(ctx, "products:write");
  const input = parseProductInput(raw);
  try {
    return await writeTx(async (tx) => {
      const brandId = await resolveBrand(tx, ctx.tenantId, input.brand);
      const categoryId = await resolveCategory(tx, ctx.tenantId, input.category);
      const p = await tx.product.create({
        data: { ...scalarData(input), tenantId: ctx.tenantId, brandId, categoryId, createdById: ctx.userId, updatedById: ctx.userId },
        select: { id: true },
      });
      await setTags(tx, ctx.tenantId, p.id, input.tags);
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId,
        action: "product.create",
        entityType: "Product",
        entityId: p.id,
        diff: { sku: input.sku, name: input.name, status: input.status },
      });
      return p;
    });
  } catch (err) {
    translateUnique(err);
  }
}

/** UPDATE condicionado à versão esperada; 0 linhas => 404 ou 409. */
async function bumpVersion(tx: Tx, ctx: TenantContext, id: string, expectedVersion: number, data: Prisma.ProductUncheckedUpdateManyInput) {
  const res = await tx.product.updateMany({
    where: { id, tenantId: ctx.tenantId, version: expectedVersion },
    data: { ...data, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() },
  });
  if (res.count === 1) return;
  const exists = await tx.product.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { version: true } });
  if (!exists) throw notFound("Produto");
  throw new DomainError(
    "VERSION_CONFLICT",
    "Este produto foi alterado por outra pessoa depois que você abriu a página. Recarregue para ver a versão atual; suas alterações não foram salvas.",
  );
}

export async function updateProduct(ctx: TenantContext, id: string, expectedVersion: number, raw: unknown): Promise<{ version: number }> {
  assertCan(ctx, "products:write");
  if (!isUuid(id)) throw notFound("Produto");
  const input = parseProductInput(raw);
  try {
    return await writeTx(async (tx) => {
      const before = await tx.product.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!before) throw notFound("Produto");
      if (before.status === "ARCHIVED") throw new DomainError("CONFLICT", "Restaure o produto antes de editá-lo.");
      const brandId = await resolveBrand(tx, ctx.tenantId, input.brand);
      const categoryId = await resolveCategory(tx, ctx.tenantId, input.category);
      const data = { ...scalarData(input), brandId, categoryId };
      await bumpVersion(tx, ctx, id, expectedVersion, data);
      await setTags(tx, ctx.tenantId, id, input.tags);
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId,
        action: "product.update",
        entityType: "Product",
        entityId: id,
        diff: shallowDiff(before as unknown as Record<string, unknown>, data, AUDIT_FIELDS),
      });
      return { version: expectedVersion + 1 };
    });
  } catch (err) {
    translateUnique(err);
  }
}

export async function setArchived(ctx: TenantContext, id: string, expectedVersion: number, archived: boolean): Promise<void> {
  assertCan(ctx, "products:write");
  if (!isUuid(id)) throw notFound("Produto");
  await writeTx(async (tx) => {
    await bumpVersion(
      tx,
      ctx,
      id,
      expectedVersion,
      archived ? { status: "ARCHIVED", archivedAt: new Date() } : { status: "DRAFT", archivedAt: null },
    );
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId,
      action: archived ? "product.archive" : "product.restore",
      entityType: "Product",
      entityId: id,
    });
  });
}

/** Duplica como rascunho com novo SKU. Copia vínculos de fotos; não copia histórico. */
export async function duplicateProduct(ctx: TenantContext, id: string, newSkuRaw: string): Promise<{ id: string }> {
  assertCan(ctx, "products:write");
  if (!isUuid(id)) throw notFound("Produto");
  const src = await getDb().product.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { tags: { select: { tagId: true } }, media: { select: { mediaId: true, position: true, altText: true } } },
  });
  if (!src) throw notFound("Produto");
  const sku = String(newSkuRaw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!sku || sku.length > 80) throw validation({ sku: "Informe um SKU novo com até 80 caracteres." });
  try {
    return await writeTx(async (tx) => {
      const p = await tx.product.create({
        data: {
          tenantId: ctx.tenantId,
          sku,
          normalizedSku: normalizeCode(sku),
          name: src.name,
          brandId: src.brandId,
          categoryId: src.categoryId,
          model: src.model,
          // Código do fabricante é único por marca: a cópia começa sem ele.
          manufacturerCode: null,
          normalizedManufacturerCode: null,
          gtin: null,
          description: src.description,
          unit: src.unit,
          status: "DRAFT",
          specs: src.specs as Prisma.InputJsonValue,
          links: src.links as Prisma.InputJsonValue,
          internalNotes: src.internalNotes,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
        select: { id: true },
      });
      if (src.tags.length) await tx.productTag.createMany({ data: src.tags.map((t) => ({ tenantId: ctx.tenantId, productId: p.id, tagId: t.tagId })) });
      if (src.media.length) {
        await tx.productMedia.createMany({
          data: src.media.map((m) => ({ tenantId: ctx.tenantId, productId: p.id, mediaId: m.mediaId, position: m.position, altText: m.altText })),
        });
        if (src.coverMediaId) await tx.product.update({ where: { id: p.id }, data: { coverMediaId: src.coverMediaId } });
      }
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId,
        action: "product.duplicate",
        entityType: "Product",
        entityId: p.id,
        diff: { from: id, sku },
      });
      return p;
    });
  } catch (err) {
    translateUnique(err);
  }
}
