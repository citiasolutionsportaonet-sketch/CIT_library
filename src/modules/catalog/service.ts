import "server-only";
import type { Prisma, ProductStatus } from "@/generated/prisma/client";
import { cleanText, normalizeName } from "@/lib/normalize";
import { buildProductWhere, type ListParams, withSubcategories } from "@/modules/products/service";
import { guessModel } from "@/modules/research/match";
import { audit } from "@/server/audit";
import { assertCan, type TenantContext } from "@/server/authorize";
import { getDb, type Tx } from "@/server/db";
import { DomainError, notFound, validation } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { proposeBrand, proposeCategory, RULES_VERSION } from "./category-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Cadastros auxiliares
// ---------------------------------------------------------------------------

export async function taxonomy(ctx: TenantContext) {
  assertCan(ctx, "catalog:read");
  const db = getDb();
  const [brands, categories, tags] = await Promise.all([
    db.brand.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }], include: { _count: { select: { products: true } } } }),
    db.category.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }], include: { _count: { select: { products: true, children: true } } } }),
    db.tag.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ name: "asc" }, { id: "asc" }], include: { _count: { select: { products: true } } } }),
  ]);
  // Árvore com caminho completo e total incluindo subcategorias.
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    let cur = byId.get(id);
    for (let i = 0; cur && i < 10; i++) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" > ");
  };
  const totals = new Map<string, number>();
  for (const c of categories) {
    let cur: typeof c | undefined = c;
    for (let i = 0; cur && i < 10; i++) {
      totals.set(cur.id, (totals.get(cur.id) ?? 0) + c._count.products);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return {
    brands: brands.map((b) => ({ id: b.id, name: b.name, active: b.active, products: b._count.products })),
    categories: categories
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, active: c.active, path: pathOf(c.id), products: c._count.products, total: totals.get(c.id) ?? 0, children: c._count.children }))
      .sort((a, b) => a.path.localeCompare(b.path, "pt-BR")),
    tags: tags.map((t) => ({ id: t.id, name: t.name, products: t._count.products })),
  };
}

const NAME = (raw: unknown, max = 120) => {
  const n = cleanText(String(raw ?? ""));
  if (!n || n.length > max) throw validation({ name: `Informe um nome com até ${max} caracteres.` });
  return n;
};

function uniqueError(e: unknown, what: string): never {
  if ((e as { code?: string })?.code === "P2002") throw new DomainError("CONFLICT", `Já existe ${what} com esse nome.`, { name: "Nome já usado." });
  throw e;
}

/** Garante que `parentId` não é a própria categoria nem um descendente dela. */
async function assertNoCycle(tx: Tx, tenantId: string, id: string, parentId: string | null) {
  let cur = parentId;
  for (let i = 0; cur && i < 50; i++) {
    if (cur === id) throw new DomainError("CONFLICT", "Uma categoria não pode ficar dentro dela mesma ou de uma subcategoria sua.");
    cur = (await tx.category.findFirst({ where: { id: cur, tenantId }, select: { parentId: true } }))?.parentId ?? null;
  }
}

export async function saveCategory(ctx: TenantContext, input: { id?: string; name: unknown; parentId?: string | null }) {
  assertCan(ctx, "products:write");
  const name = NAME(input.name);
  const parentId = input.parentId && UUID.test(input.parentId) ? input.parentId : null;
  try {
    return await writeTx(async (tx) => {
      if (parentId && !(await tx.category.findFirst({ where: { id: parentId, tenantId: ctx.tenantId } }))) throw notFound("Categoria-mãe");
      if (input.id) {
        const c = await tx.category.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
        if (!c) throw notFound("Categoria");
        await assertNoCycle(tx, ctx.tenantId, c.id, parentId);
        await tx.category.update({ where: { id: c.id }, data: { name, normalizedName: normalizeName(name), parentId } });
        await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "category.update", entityType: "Category", entityId: c.id, diff: { de: { name: c.name, parentId: c.parentId }, para: { name, parentId } } });
        return c.id;
      }
      const c = await tx.category.create({ data: { tenantId: ctx.tenantId, name, normalizedName: normalizeName(name), parentId } });
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "category.create", entityType: "Category", entityId: c.id, diff: { name, parentId } });
      return c.id;
    });
  } catch (e) {
    uniqueError(e, "uma categoria");
  }
}

export async function saveBrand(ctx: TenantContext, input: { id?: string; name: unknown }) {
  assertCan(ctx, "products:write");
  const name = NAME(input.name);
  try {
    return await writeTx(async (tx) => {
      if (input.id) {
        const b = await tx.brand.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
        if (!b) throw notFound("Marca");
        await tx.brand.update({ where: { id: b.id }, data: { name, normalizedName: normalizeName(name) } });
        await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "brand.update", entityType: "Brand", entityId: b.id, diff: { de: b.name, para: name } });
        return b.id;
      }
      const b = await tx.brand.create({ data: { tenantId: ctx.tenantId, name, normalizedName: normalizeName(name) } });
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "brand.create", entityType: "Brand", entityId: b.id, diff: { name } });
      return b.id;
    });
  } catch (e) {
    uniqueError(e, "uma marca");
  }
}

/** Itens em uso não são excluídos: só desativados (saem das sugestões). */
export async function setTaxonomyActive(ctx: TenantContext, kind: "brand" | "category", id: string, active: boolean) {
  assertCan(ctx, "products:write");
  await writeTx(async (tx) => {
    const n = kind === "brand"
      ? (await tx.brand.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { active } })).count
      : (await tx.category.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { active } })).count;
    if (!n) throw notFound(kind === "brand" ? "Marca" : "Categoria");
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: `${kind}.${active ? "activate" : "deactivate"}`, entityType: kind === "brand" ? "Brand" : "Category", entityId: id });
  });
}

export async function deleteTaxonomy(ctx: TenantContext, kind: "brand" | "category" | "tag", id: string) {
  assertCan(ctx, "products:write");
  await writeTx(async (tx) => {
    if (kind === "brand") {
      const b = await tx.brand.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { products: true } } } });
      if (!b) throw notFound("Marca");
      if (b._count.products) throw new DomainError("CONFLICT", `Marca em uso por ${b._count.products} produto(s): desative em vez de excluir.`);
      await tx.brand.delete({ where: { id: b.id } });
    } else if (kind === "category") {
      const c = await tx.category.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { products: true, children: true } } } });
      if (!c) throw notFound("Categoria");
      if (c._count.products || c._count.children) throw new DomainError("CONFLICT", "Categoria com produtos ou subcategorias: desative ou esvazie antes.");
      await tx.category.delete({ where: { id: c.id } });
    } else {
      const t = await tx.tag.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { products: true } } } });
      if (!t) throw notFound("Tag");
      if (t._count.products) throw new DomainError("CONFLICT", `Tag em uso por ${t._count.products} produto(s).`);
      await tx.tag.delete({ where: { id: t.id } });
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: `${kind}.delete`, entityType: kind, entityId: id });
  });
}

// ---------------------------------------------------------------------------
// Classificação proposta (regras) — revisão e aplicação em lote
// ---------------------------------------------------------------------------

export async function classificationPreview(ctx: TenantContext) {
  assertCan(ctx, "catalog:read");
  const products = await getDb().product.findMany({
    where: { tenantId: ctx.tenantId, status: { not: "ARCHIVED" } },
    select: { id: true, sku: true, name: true, categoryId: true, brandId: true },
    orderBy: { sku: "asc" },
  });
  const cats = new Map<string, { count: number; samples: { sku: string; name: string }[] }>();
  const brands = new Map<string, { count: number; samples: { sku: string; name: string }[] }>();
  const unmatched: { sku: string; name: string }[] = [];
  let alreadyCategorized = 0;
  for (const p of products) {
    if (p.categoryId) alreadyCategorized++;
    else {
      const c = proposeCategory(p.name);
      if (!c) unmatched.push({ sku: p.sku, name: p.name });
      else {
        const g = cats.get(c) ?? { count: 0, samples: [] };
        g.count++;
        if (g.samples.length < 8) g.samples.push({ sku: p.sku, name: p.name });
        cats.set(c, g);
      }
    }
    if (!p.brandId) {
      const b = proposeBrand(p.name);
      if (b) {
        const g = brands.get(b) ?? { count: 0, samples: [] };
        g.count++;
        if (g.samples.length < 5) g.samples.push({ sku: p.sku, name: p.name });
        brands.set(b, g);
      }
    }
  }
  return {
    rulesVersion: RULES_VERSION,
    total: products.length,
    alreadyCategorized,
    categories: [...cats].map(([path, g]) => ({ path, ...g })).sort((a, b) => a.path.localeCompare(b.path, "pt-BR")),
    unmatched: { count: unmatched.length, samples: unmatched.slice(0, 30) },
    brands: [...brands].map(([brand, g]) => ({ brand, ...g })).sort((a, b) => b.count - a.count),
  };
}

async function ensureCategoryPath(tx: Tx, tenantId: string, path: string): Promise<string> {
  let parentId: string | null = null;
  for (const raw of path.split(">").map((s) => s.trim()).filter(Boolean)) {
    const nn = normalizeName(raw);
    const existing: { id: string; parentId: string | null } | null = await tx.category.findUnique({ where: { tenantId_normalizedName: { tenantId, normalizedName: nn } }, select: { id: true, parentId: true } });
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created: { id: string } = await tx.category.create({ data: { tenantId, name: raw, normalizedName: nn, parentId }, select: { id: true } });
    parentId = created.id;
  }
  if (!parentId) throw validation({ path: "Caminho de categoria vazio." });
  return parentId;
}

/**
 * Aplica as categorias propostas escolhidas. A proposta é RECALCULADA no
 * servidor (não confia em listas vindas do navegador) e só atinge produtos
 * ainda sem categoria; produtos já classificados nunca são sobrescritos.
 */
export async function applyCategoryProposals(ctx: TenantContext, paths: string[]) {
  assertCan(ctx, "products:write");
  const wanted = new Set(paths.map(String));
  const products = await getDb().product.findMany({ where: { tenantId: ctx.tenantId, status: { not: "ARCHIVED" }, categoryId: null }, select: { id: true, name: true } });
  const groups = new Map<string, string[]>();
  for (const p of products) {
    const c = proposeCategory(p.name);
    if (c && wanted.has(c)) groups.set(c, [...(groups.get(c) ?? []), p.id]);
  }
  let updated = 0;
  for (const [path, ids] of groups) {
    await writeTx(async (tx) => {
      const categoryId = await ensureCategoryPath(tx, ctx.tenantId, path);
      for (let i = 0; i < ids.length; i += 500) {
        const r = await tx.product.updateMany({
          where: { tenantId: ctx.tenantId, id: { in: ids.slice(i, i + 500) }, categoryId: null },
          data: { categoryId, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() },
        });
        updated += r.count;
      }
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "catalog.classify.category", entityType: "Category", entityId: categoryId, diff: { path, products: ids.length, rulesVersion: RULES_VERSION } });
    }, { timeout: 60_000 });
  }
  return { updated };
}

export async function applyBrandProposals(ctx: TenantContext, brandNames: string[]) {
  assertCan(ctx, "products:write");
  const wanted = new Set(brandNames.map(String));
  const products = await getDb().product.findMany({ where: { tenantId: ctx.tenantId, status: { not: "ARCHIVED" }, brandId: null }, select: { id: true, name: true } });
  const groups = new Map<string, string[]>();
  for (const p of products) {
    const b = proposeBrand(p.name);
    if (b && wanted.has(b)) groups.set(b, [...(groups.get(b) ?? []), p.id]);
  }
  let updated = 0;
  for (const [name, ids] of groups) {
    await writeTx(async (tx) => {
      const nn = normalizeName(name);
      const brand = await tx.brand.upsert({ where: { tenantId_normalizedName: { tenantId: ctx.tenantId, normalizedName: nn } }, create: { tenantId: ctx.tenantId, name, normalizedName: nn }, update: {} });
      const r = await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: ids }, brandId: null }, data: { brandId: brand.id, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() } });
      updated += r.count;
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "catalog.classify.brand", entityType: "Brand", entityId: brand.id, diff: { brand: name, products: ids.length, rulesVersion: RULES_VERSION } });
    }, { timeout: 60_000 });
  }
  return { updated };
}

/**
 * Preenche só o campo de SUGESTÃO de modelo (não altera o modelo oficial).
 * Com `recompute`, refaz também sugestões já geradas pelo extrator; sugestões
 * vindas de planilha/pesquisa (produtos com evidência preliminar) são mantidas.
 */
export async function fillSuggestedModels(ctx: TenantContext, opts: { recompute?: boolean } = {}) {
  assertCan(ctx, "products:write");
  const where: Prisma.ProductWhereInput = opts.recompute
    ? { tenantId: ctx.tenantId, model: null, researchAssets: { none: { origin: "IMPORT_PRELIMINARY" } }, offers: { none: { origin: "IMPORT_PRELIMINARY" } } }
    : { tenantId: ctx.tenantId, suggestedModel: null, model: null };
  const products = await getDb().product.findMany({ where, select: { id: true, name: true, suggestedModel: true } });
  let filled = 0;
  let cleared = 0;
  for (let i = 0; i < products.length; i += 500) {
    await writeTx(async (tx) => {
      for (const p of products.slice(i, i + 500)) {
        const m = guessModel(p.name);
        if (m === p.suggestedModel) continue;
        await tx.product.update({ where: { id: p.id }, data: { suggestedModel: m } });
        if (m) filled++;
        else cleared++;
      }
    }, { timeout: 60_000 });
  }
  await writeTx((tx) => audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "catalog.suggest_models", entityType: "Tenant", entityId: ctx.tenantId, diff: { filled, cleared, scanned: products.length, recompute: !!opts.recompute } }));
  return { filled, cleared, scanned: products.length };
}

/** Usa a sugestão de modelo/fabricante como dado oficial (um produto). */
export async function acceptSuggestion(ctx: TenantContext, productId: string, field: "model" | "manufacturer") {
  assertCan(ctx, "products:write");
  if (!UUID.test(productId)) throw notFound("Produto");
  await writeTx(async (tx) => {
    const p = await tx.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId } });
    if (!p) throw notFound("Produto");
    if (field === "model") {
      if (!p.suggestedModel) throw new DomainError("CONFLICT", "Sem sugestão de modelo.");
      if (p.model) throw new DomainError("CONFLICT", "O produto já tem modelo.");
      await tx.product.update({ where: { id: p.id }, data: { model: p.suggestedModel, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() } });
    } else {
      if (!p.suggestedManufacturer) throw new DomainError("CONFLICT", "Sem sugestão de fabricante.");
      if (p.brandId) throw new DomainError("CONFLICT", "O produto já tem marca.");
      const nn = normalizeName(p.suggestedManufacturer);
      const b = await tx.brand.upsert({ where: { tenantId_normalizedName: { tenantId: ctx.tenantId, normalizedName: nn } }, create: { tenantId: ctx.tenantId, name: p.suggestedManufacturer, normalizedName: nn }, update: {} });
      await tx.product.update({ where: { id: p.id }, data: { brandId: b.id, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() } });
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: `product.accept_suggestion.${field}`, entityType: "Product", entityId: p.id, diff: { model: p.suggestedModel, manufacturer: p.suggestedManufacturer } });
  });
}

// ---------------------------------------------------------------------------
// Edição em massa (sobre o resultado de um filtro do catálogo)
// ---------------------------------------------------------------------------

export const BULK_MAX = 5000;
export type BulkChange =
  | { kind: "category"; categoryId: string }
  | { kind: "brand"; brandId: string }
  | { kind: "addTag"; tag: string }
  | { kind: "status"; status: Extract<ProductStatus, "DRAFT" | "ACTIVE"> };

export async function bulkUpdate(ctx: TenantContext, filter: ListParams, change: BulkChange, expectedCount: number) {
  assertCan(ctx, "products:write");
  const where = buildProductWhere(ctx, await withSubcategories(ctx, filter));
  const ids = (await getDb().product.findMany({ where, select: { id: true }, take: BULK_MAX + 1 })).map((p) => p.id);
  if (ids.length > BULK_MAX) throw new DomainError("CONFLICT", `O filtro atinge mais de ${BULK_MAX} produtos. Refine a busca.`);
  // Confirma que o usuário viu o mesmo total que será alterado.
  if (ids.length !== expectedCount) throw new DomainError("CONFLICT", `O resultado mudou (${ids.length} em vez de ${expectedCount}). Recarregue antes de aplicar.`);
  if (ids.length === 0) return { updated: 0, skipped: 0 };
  let updated = 0;
  let skipped = 0;
  const stamp = { version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() } as const;
  await writeTx(async (tx) => {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      if (change.kind === "category") {
        if (!(await tx.category.findFirst({ where: { id: change.categoryId, tenantId: ctx.tenantId } }))) throw notFound("Categoria");
        updated += (await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: chunk } }, data: { categoryId: change.categoryId, ...stamp } })).count;
      } else if (change.kind === "brand") {
        if (!(await tx.brand.findFirst({ where: { id: change.brandId, tenantId: ctx.tenantId } }))) throw notFound("Marca");
        // Código do fabricante é único por marca: quem tem código mantém a marca atual.
        const r = await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: chunk }, normalizedManufacturerCode: null }, data: { brandId: change.brandId, ...stamp } });
        updated += r.count;
        skipped += chunk.length - r.count;
      } else if (change.kind === "status") {
        // Ativar exige marca e modelo; os demais ficam como estão.
        const extra: Prisma.ProductWhereInput = change.status === "ACTIVE" ? { brandId: { not: null }, model: { not: null } } : {};
        const r = await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: chunk }, status: { not: "ARCHIVED" }, ...extra }, data: { status: change.status, ...stamp } });
        updated += r.count;
        skipped += chunk.length - r.count;
      } else {
        const name = NAME(change.tag, 60);
        const nn = normalizeName(name);
        const tag = await tx.tag.upsert({ where: { tenantId_normalizedName: { tenantId: ctx.tenantId, normalizedName: nn } }, create: { tenantId: ctx.tenantId, name, normalizedName: nn }, update: {} });
        const r = await tx.productTag.createMany({ data: chunk.map((productId) => ({ tenantId: ctx.tenantId, productId, tagId: tag.id })), skipDuplicates: true });
        updated += r.count;
        skipped += chunk.length - r.count;
      }
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "catalog.bulk_update", entityType: "Tenant", entityId: ctx.tenantId, diff: { change, filter, matched: ids.length, updated, skipped, sample: ids.slice(0, 20) } });
  }, { timeout: 120_000 });
  return { updated, skipped };
}
