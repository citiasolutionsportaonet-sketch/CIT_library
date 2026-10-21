import "server-only";
import type { Prisma, ResearchStatus } from "@/generated/prisma/client";
import { cleanText, normalizeCode, normalizeName } from "@/lib/normalize";
import { uploadProductImage } from "@/modules/media/service";
import { readXlsx } from "@/modules/imports/xlsx";
import { audit } from "@/server/audit";
import { assertCan, type TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { DomainError, notFound, validation } from "@/server/errors";
import { enqueueMany } from "@/server/jobs/queue";
import { writeTx } from "@/server/maintenance";
import { IMAGE_ACCEPT, politeFetch } from "./http";
import { fileTypeFromBuffer } from "file-type";
import { PROVIDERS, providerStatus } from "./providers";
import { computeResearchStatus, MAX_IMAGES_PER_PRODUCT } from "./status";

// ---------------------------------------------------------------------------
// Execuções
// ---------------------------------------------------------------------------

export type CreateRunInput = {
  name?: string;
  productIds?: string[];
  filter?: { researchStatus?: ResearchStatus[]; onlyWithCost?: boolean };
  limit: number;
  providers: string[];
  maxApiCalls: number;
  maxCostCents: number;
  /** Aprovar automaticamente imagens oficiais verificadas (até 3 por produto). */
  autoApproveOfficialImages?: boolean;
};

export async function createRun(ctx: TenantContext, input: CreateRunInput) {
  assertCan(ctx, "research:run");
  const limit = Math.floor(Number(input.limit));
  if (!(limit >= 1 && limit <= 5000)) throw validation({ limit: "Quantidade entre 1 e 5000 produtos." });
  const known = new Set(PROVIDERS.map((p) => p.id));
  const providers = [...new Set(input.providers)].filter((p) => known.has(p));
  if (providers.length === 0) throw validation({ providers: "Selecione ao menos um provedor." });
  const unconfigured = providerStatus().filter((p) => providers.includes(p.id) && !p.configured);
  if (unconfigured.length) throw validation({ providers: `Sem credencial configurada: ${unconfigured.map((p) => p.label).join(", ")}.` });
  const maxApiCalls = Math.floor(Number(input.maxApiCalls));
  const maxCostCents = Math.floor(Number(input.maxCostCents));
  if (!(maxApiCalls >= 0 && maxApiCalls <= 100_000) || !(maxCostCents >= 0 && maxCostCents <= 10_000_000)) {
    throw validation({ budget: "Orçamento inválido." });
  }
  const db = getDb();
  const where: Prisma.ProductWhereInput = { tenantId: ctx.tenantId, status: { not: "ARCHIVED" } };
  if (input.productIds?.length) where.id = { in: input.productIds.slice(0, 5000) };
  if (input.filter?.researchStatus?.length) where.researchStatus = { in: input.filter.researchStatus };
  if (input.filter?.onlyWithCost) where.prices = { some: { priceList: { kind: "COST" } } };
  // Não enfileira produto que já está em outra execução ativa.
  where.NOT = { researchStatus: { in: ["QUEUED", "IN_PROGRESS"] } };
  const products = await db.product.findMany({ where, orderBy: [{ sku: "asc" }, { id: "asc" }], take: limit, select: { id: true } });
  if (products.length === 0) throw new DomainError("CONFLICT", "Nenhum produto elegível para esta execução.");

  return writeTx(async (tx) => {
    const run = await tx.researchRun.create({
      data: {
        tenantId: ctx.tenantId,
        name: cleanText(input.name ?? "").slice(0, 120) || `Pesquisa ${new Date().toLocaleString("pt-BR", { timeZone: ctx.timezone })}`,
        providers,
        options: { autoApproveOfficialImages: !!input.autoApproveOfficialImages },
        maxApiCalls,
        maxCostCents,
        totalJobs: products.length,
        createdById: ctx.userId,
      },
    });
    await enqueueMany(
      products.map((p) => ({ tenantId: ctx.tenantId, type: "RESEARCH_PRODUCT" as const, actorId: ctx.userId, runId: run.id, productId: p.id, maxAttempts: 3 })),
      tx,
    );
    await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: products.map((p) => p.id) } }, data: { researchStatus: "QUEUED" } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "research.run.create", entityType: "ResearchRun", entityId: run.id, diff: { products: products.length, providers, maxApiCalls, maxCostCents, autoApproveOfficialImages: !!input.autoApproveOfficialImages } });
    return run;
  }, { timeout: 60_000 });
}

export async function controlRun(ctx: TenantContext, runId: string, action: "pause" | "resume" | "cancel" | "retry-failed") {
  assertCan(ctx, "research:run");
  return writeTx(async (tx) => {
    const run = await tx.researchRun.findFirst({ where: { id: runId, tenantId: ctx.tenantId } });
    if (!run) throw notFound("Execução");
    let changed = 0;
    if (action === "pause") {
      if (run.status !== "RUNNING") throw new DomainError("CONFLICT", "A execução não está rodando.");
      await tx.researchRun.update({ where: { id: run.id }, data: { status: "PAUSED" } });
    } else if (action === "resume") {
      if (run.status !== "PAUSED") throw new DomainError("CONFLICT", "A execução não está pausada.");
      if (run.apiCalls >= run.maxApiCalls || run.costCents >= run.maxCostCents) {
        throw new DomainError("CONFLICT", "Orçamento esgotado. Crie uma nova execução com orçamento aprovado.");
      }
      await tx.researchRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    } else if (action === "cancel") {
      if (run.status === "CANCELED" || run.status === "COMPLETED") throw new DomainError("CONFLICT", "Execução já finalizada.");
      const queued = await tx.job.findMany({ where: { tenantId: ctx.tenantId, runId: run.id, status: "QUEUED" }, select: { productId: true } });
      changed = (await tx.job.updateMany({ where: { tenantId: ctx.tenantId, runId: run.id, status: "QUEUED" }, data: { status: "CANCELED", finishedAt: new Date() } })).count;
      await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: queued.map((q) => q.productId!).filter(Boolean) }, researchStatus: "QUEUED" }, data: { researchStatus: "PENDING" } });
      await tx.researchRun.update({ where: { id: run.id }, data: { status: "CANCELED", finishedAt: new Date() } });
    } else {
      const failed = await tx.job.findMany({ where: { tenantId: ctx.tenantId, runId: run.id, status: "FAILED" }, select: { id: true, productId: true } });
      changed = (await tx.job.updateMany({ where: { id: { in: failed.map((f) => f.id) } }, data: { status: "QUEUED", attempts: 0, runAfter: new Date(), lastError: null, finishedAt: null } })).count;
      await tx.product.updateMany({ where: { tenantId: ctx.tenantId, id: { in: failed.map((f) => f.productId!).filter(Boolean) } }, data: { researchStatus: "QUEUED" } });
      if (changed && (run.status === "COMPLETED" || run.status === "PAUSED")) await tx.researchRun.update({ where: { id: run.id }, data: { status: "RUNNING", finishedAt: null } });
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: `research.run.${action}`, entityType: "ResearchRun", entityId: run.id, diff: { jobs: changed } });
    return { changed };
  });
}

/** Fecha a execução quando não há mais jobs pendentes (chamado pelo worker). */
export async function finishRunIfDone(runId: string) {
  await writeTx(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "research_run" WHERE "id" = ${runId}::uuid FOR UPDATE`;
    const pending = await tx.job.count({ where: { runId, status: { in: ["QUEUED", "RUNNING"] } } });
    if (pending === 0) await tx.researchRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { status: "COMPLETED", finishedAt: new Date() } });
  });
}

export async function listRuns(ctx: TenantContext) {
  assertCan(ctx, "research:review");
  const db = getDb();
  const runs = await db.researchRun.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
  const counts = await db.job.groupBy({ by: ["runId", "status"], where: { tenantId: ctx.tenantId, runId: { in: runs.map((r) => r.id) } }, _count: true });
  return runs.map((r) => {
    const by = Object.fromEntries(counts.filter((c) => c.runId === r.id).map((c) => [c.status, c._count])) as Record<string, number>;
    const done = (by.SUCCEEDED ?? 0) + (by.FAILED ?? 0) + (by.CANCELED ?? 0);
    return { ...r, jobs: by, percent: r.totalJobs ? Math.floor((done / r.totalJobs) * 100) : 0 };
  });
}

export async function runErrors(ctx: TenantContext, runId: string) {
  assertCan(ctx, "research:review");
  return getDb().job.findMany({
    where: { tenantId: ctx.tenantId, runId, status: { in: ["FAILED"] } },
    orderBy: { finishedAt: "desc" },
    take: 50,
    select: { id: true, productId: true, lastError: true, attempts: true, finishedAt: true },
  });
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export async function dashboard(ctx: TenantContext) {
  assertCan(ctx, "research:review");
  const db = getDb();
  const t = ctx.tenantId;
  const [total, byStatus, imagesApproved, imagesCandidate, officialImagesReady, docs, offersAccepted, offersCandidate, productsWithPrice, failedJobs, withCost, productsNoImage, usage] = await Promise.all([
    db.product.count({ where: { tenantId: t, status: { not: "ARCHIVED" } } }),
    db.product.groupBy({ by: ["researchStatus"], where: { tenantId: t, status: { not: "ARCHIVED" } }, _count: true }),
    db.researchAsset.count({ where: { tenantId: t, kind: "IMAGE", status: "ACCEPTED" } }),
    db.researchAsset.count({ where: { tenantId: t, kind: "IMAGE", status: "CANDIDATE" } }),
    db.researchAsset.count({ where: { tenantId: t, kind: "IMAGE", status: "CANDIDATE", sourceType: "OFFICIAL", verifiedAt: { not: null }, width: { not: null } } }),
    db.researchAsset.count({ where: { tenantId: t, kind: { in: ["DATASHEET", "MANUAL"] }, status: { not: "REJECTED" } } }),
    db.marketOffer.count({ where: { tenantId: t, status: "ACCEPTED" } }),
    db.marketOffer.count({ where: { tenantId: t, status: "CANDIDATE" } }),
    db.product.count({ where: { tenantId: t, offers: { some: { status: "ACCEPTED" } } } }),
    db.job.count({ where: { tenantId: t, type: "RESEARCH_PRODUCT", status: "FAILED" } }),
    db.product.count({ where: { tenantId: t, prices: { some: { priceList: { kind: "COST" } } } } }),
    db.product.count({ where: { tenantId: t, status: { not: "ARCHIVED" }, coverMediaId: null } }),
    db.providerUsage.findMany({ orderBy: { day: "desc" }, take: 30 }),
  ]);
  const by = Object.fromEntries(byStatus.map((s) => [s.researchStatus, s._count])) as Partial<Record<ResearchStatus, number>>;
  return {
    total,
    withCost,
    enriched: by.ENRICHED ?? 0,
    awaitingReview: by.NEEDS_REVIEW ?? 0,
    pending: (by.PENDING ?? 0) + (by.QUEUED ?? 0) + (by.IN_PROGRESS ?? 0),
    noData: by.NO_DATA ?? 0,
    failed: (by.FAILED ?? 0) + failedJobs,
    imagesApproved,
    imagesCandidate,
    officialImagesReady,
    productsWithoutImage: productsNoImage,
    documents: docs,
    offersAccepted,
    offersCandidate,
    productsWithMarketPrice: productsWithPrice,
    providers: providerStatus(),
    usage,
  };
}

export async function reviewQueue(ctx: TenantContext, page = 1) {
  assertCan(ctx, "research:review");
  const db = getDb();
  const where: Prisma.ProductWhereInput = { tenantId: ctx.tenantId, researchStatus: "NEEDS_REVIEW" };
  const [total, items] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy: [{ lastResearchAt: "desc" }, { id: "asc" }], skip: (page - 1) * 30, take: 30, select: { id: true, sku: true, name: true, lastResearchAt: true, _count: { select: { offers: { where: { status: "CANDIDATE" } }, researchAssets: { where: { status: "CANDIDATE" } } } } } }),
  ]);
  return { total, items, page, pageCount: Math.max(1, Math.ceil(total / 30)) };
}

// ---------------------------------------------------------------------------
// Evidências por produto e revisão
// ---------------------------------------------------------------------------

export async function productResearch(ctx: TenantContext, productId: string) {
  assertCan(ctx, "catalog:read");
  const db = getDb();
  const [assets, offers] = await Promise.all([
    db.researchAsset.findMany({ where: { tenantId: ctx.tenantId, productId }, orderBy: [{ kind: "asc" }, { createdAt: "desc" }] }),
    db.marketOffer.findMany({ where: { tenantId: ctx.tenantId, productId }, orderBy: [{ status: "asc" }, { observedAt: "desc" }, { id: "asc" }], take: 100 }),
  ]);
  return {
    assets: assets.map((a) => ({ ...a, data: a.data as Record<string, unknown> })),
    offers: offers.map((o) => ({ ...o, price: o.price.toFixed(2), shipping: o.shipping?.toFixed(2) ?? null, matchReasons: o.matchReasons as string[] })),
  };
}

async function refreshResearchStatus(tx: Prisma.TransactionClient, tenantId: string, productId: string) {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { researchStatus: true } });
  if (!p || ["QUEUED", "IN_PROGRESS"].includes(p.researchStatus)) return;
  await tx.product.update({ where: { id: productId }, data: { researchStatus: await computeResearchStatus(tx, tenantId, productId) } });
}

export async function reviewOffer(ctx: TenantContext, offerId: string, decision: "ACCEPTED" | "REJECTED", note?: string) {
  assertCan(ctx, "research:review");
  await writeTx(async (tx) => {
    const o = await tx.marketOffer.findFirst({ where: { id: offerId, tenantId: ctx.tenantId } });
    if (!o) throw notFound("Oferta");
    if (decision === "ACCEPTED" && o.isListingPage) throw new DomainError("CONFLICT", "Página de busca/listagem não é uma oferta individual e não pode entrar na mediana.");
    await tx.marketOffer.update({ where: { id: o.id }, data: { status: decision, reviewNote: note?.slice(0, 500) ?? null, reviewedById: ctx.userId, reviewedAt: new Date() } });
    await refreshResearchStatus(tx, ctx.tenantId, o.productId);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: `offer.${decision.toLowerCase()}`, entityType: "Product", entityId: o.productId, diff: { offerId: o.id, price: o.price.toFixed(2), url: o.url } });
  });
}

/**
 * Aprovar imagem: baixa de novo, passa pelo MESMO pipeline do upload manual
 * (MIME por conteúdo, Sharp, sem EXIF) e entra na galeria. Máx. 3 por pesquisa.
 */
export async function approveAsset(ctx: TenantContext, assetId: string, note?: string) {
  assertCan(ctx, "research:review");
  const db = getDb();
  const a = await db.researchAsset.findFirst({ where: { id: assetId, tenantId: ctx.tenantId } });
  if (!a) throw notFound("Evidência");
  if (a.status === "ACCEPTED") return;
  let mediaId: string | null = null;
  if (a.kind === "IMAGE") {
    assertCan(ctx, "products:write");
    const approved = await db.researchAsset.count({ where: { tenantId: ctx.tenantId, productId: a.productId, kind: "IMAGE", status: "ACCEPTED" } });
    if (approved >= MAX_IMAGES_PER_PRODUCT) throw new DomainError("CONFLICT", `Já há ${MAX_IMAGES_PER_PRODUCT} imagens aprovadas para este produto.`);
    const res = await politeFetch(a.url, { maxBytes: 10 * 1024 * 1024, accept: IMAGE_ACCEPT });
    if (res.status !== 200) throw new DomainError("CONFLICT", `A imagem não está mais acessível (HTTP ${res.status}).`);
    // CDNs negociam formato: o nome segue o conteúdo realmente baixado.
    const ft = await fileTypeFromBuffer(res.body);
    const ext = ft?.mime === "image/png" ? "png" : ft?.mime === "image/webp" ? "webp" : ft?.mime === "image/jpeg" ? "jpg" : "bin";
    const stream = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new Uint8Array(res.body)), c.close()) });
    const up = await uploadProductImage(ctx, a.productId, stream, `${a.sourceName}-${a.id.slice(0, 8)}.${ext}`, res.body.length);
    mediaId = up.mediaId;
  }
  await writeTx(async (tx) => {
    await tx.researchAsset.update({ where: { id: a.id }, data: { status: "ACCEPTED", mediaId, reviewedById: ctx.userId, reviewedAt: new Date(), ...(note ? { reviewNote: note.slice(0, 500) } : {}) } });
    if (a.kind === "DATASHEET" || a.kind === "MANUAL" || a.kind === "OFFICIAL_PAGE") {
      const p = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { links: true } });
      const links = (p.links as { label?: string; url: string }[]) ?? [];
      if (!links.some((l) => l.url === a.url) && links.length < 20) {
        const label = a.kind === "MANUAL" ? "Manual oficial" : a.kind === "DATASHEET" ? "Ficha técnica oficial" : "Página oficial";
        await tx.product.update({ where: { id: a.productId }, data: { links: [...links, { label: `${label} (${a.sourceName})`, url: a.url }] } });
      }
    }
    if (a.kind === "SPEC") {
      const d = a.data as { manufacturer?: string; model?: string };
      const p = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { brandId: true, model: true, version: true } });
      const data: Prisma.ProductUncheckedUpdateInput = {};
      if (d.manufacturer && !p.brandId) {
        const nn = normalizeName(d.manufacturer);
        const b = await tx.brand.upsert({ where: { tenantId_normalizedName: { tenantId: ctx.tenantId, normalizedName: nn } }, create: { tenantId: ctx.tenantId, name: d.manufacturer, normalizedName: nn }, update: {} });
        data.brandId = b.id;
      }
      if (d.model && !p.model) data.model = d.model;
      if (Object.keys(data).length) await tx.product.update({ where: { id: a.productId }, data: { ...data, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() } });
    }
    await refreshResearchStatus(tx, ctx.tenantId, a.productId);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "research.asset.approve", entityType: "Product", entityId: a.productId, diff: { assetId: a.id, kind: a.kind, url: a.url, sourceType: a.sourceType, mediaId, note: note ?? null } });
  });
}

export async function rejectAsset(ctx: TenantContext, assetId: string, note?: string) {
  assertCan(ctx, "research:review");
  await writeTx(async (tx) => {
    const a = await tx.researchAsset.findFirst({ where: { id: assetId, tenantId: ctx.tenantId } });
    if (!a) throw notFound("Evidência");
    await tx.researchAsset.update({ where: { id: a.id }, data: { status: "REJECTED", reviewNote: note?.slice(0, 500) ?? "Rejeitado na revisão", reviewedById: ctx.userId, reviewedAt: new Date() } });
    await refreshResearchStatus(tx, ctx.tenantId, a.productId);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "research.asset.reject", entityType: "Product", entityId: a.productId, diff: { assetId: a.id, kind: a.kind, url: a.url } });
  });
}

// ---------------------------------------------------------------------------
// Dados preliminares do lote 01 (planilha de pesquisa manual)
// ---------------------------------------------------------------------------

/**
 * Importa as abas "Ofertas Web", "Imagens Lote 01" e "Pesquisa Piloto Web".
 * Tudo entra como CANDIDATO de origem IMPORT_PRELIMINARY. Links de páginas de
 * busca (lista.mercadolivre…) são marcados como listagem e nunca entram na mediana.
 */
export async function importPreliminaryResearch(ctx: TenantContext, bytes: Uint8Array, observedDateFallback: Date) {
  assertCan(ctx, "research:review");
  const db = getDb();
  const products = new Map((await db.product.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, normalizedSku: true } })).map((p) => [p.normalizedSku, p.id]));
  const rowsOf = (sheet: string) => {
    const { sheet: s } = readXlsx(bytes, { sheetName: sheet });
    const [h, ...rows] = s.rows;
    // Array.from: o vetor de células é esparso (colunas vazias viram buracos).
    const names = Array.from(h.cells, (c) => normalizeName(c?.value ?? ""));
    return rows.map((r) => Object.fromEntries(names.map((n, i) => [n, (r.cells[i]?.value ?? "").trim()])));
  };
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : observedDateFallback);
  const report = { offers: 0, listingPages: 0, images: 0, pages: 0, docs: 0, models: 0, unknownProducts: [] as string[] };

  const piloto = rowsOf("Pesquisa Piloto Web");
  const modelByCode = new Map(piloto.map((r) => [normalizeCode(r["codigo cit"]), { model: r["modelo"], category: r["categoria"] }]));
  const offers = rowsOf("Ofertas Web");
  const images = rowsOf("Imagens Lote 01");

  await writeTx(async (tx) => {
    for (const [code, info] of modelByCode) {
      const pid = products.get(code);
      if (!pid) {
        report.unknownProducts.push(code);
        continue;
      }
      if (info.model) {
        await tx.product.update({ where: { id: pid }, data: { suggestedModel: info.model.slice(0, 120), suggestedManufacturer: null } });
        report.models++;
      }
    }
    for (const o of offers) {
      const pid = products.get(normalizeCode(o["codigo do produto"]));
      const price = Number(o["preco anunciado"]);
      if (!pid || !/^https?:\/\//.test(o["url anuncio"]) || !(price > 0)) continue;
      const listing = /lista\.mercadolivre|\/loja\/|[?&](q|search)=/i.test(o["url anuncio"]);
      const inserted = await tx.marketOffer.createMany({
        skipDuplicates: true,
        data: [{
          tenantId: ctx.tenantId, productId: pid, provider: "planilha-lote-01", sourceName: o["fonte"].slice(0, 120) || "Planilha", url: o["url anuncio"].slice(0, 2000),
          title: `${o["modelo confirmado"] || "Correspondência preliminar"} — ${o["observacoes"]}`.slice(0, 300), price: String(price), currency: "BRL", condition: "UNKNOWN",
          observedAt: date(o["data consulta"]), origin: "IMPORT_PRELIMINARY", isListingPage: listing, status: "CANDIDATE",
          reviewNote: listing ? "Link de página de busca/loja, não de anúncio individual: não entra na mediana." : "Preliminar da planilha: validar.",
        }],
      });
      // Conta só o que foi gravado agora (reexecução é idempotente).
      report.offers += inserted.count;
      if (listing) report.listingPages += inserted.count;
    }
    for (const r of images) {
      const code = [...modelByCode].find(([, v]) => normalizeName(v.model) === normalizeName(r["modelo"]))?.[0];
      const pid = code ? products.get(code) : undefined;
      if (!pid) continue;
      const add = async (kind: "IMAGE" | "OFFICIAL_PAGE" | "DATASHEET", url: string, source: string) => {
        if (!/^https?:\/\//.test(url)) return;
        const official = /intelbras\.com/i.test(url);
        const inserted = await tx.researchAsset.createMany({
          skipDuplicates: true,
          data: [{ tenantId: ctx.tenantId, productId: pid, kind, url: url.slice(0, 2000), sourceType: official ? "OFFICIAL" : "RESELLER", sourceName: (source || new URL(url).hostname).slice(0, 120), origin: "IMPORT_PRELIMINARY", status: "CANDIDATE", reviewNote: official ? "Preliminar (planilha): validar acesso." : "Imagem de revendedor (planilha): confirmar autorização de uso antes de aprovar." }],
        });
        if (kind === "IMAGE") report.images += inserted.count;
        else if (kind === "OFFICIAL_PAGE") report.pages += inserted.count;
        else report.docs += inserted.count;
      };
      await add("IMAGE", r["imagem 1 url"], r["origem 1"]);
      await add("IMAGE", r["imagem 2 url"], r["origem 2"]);
      await add("IMAGE", r["imagem 3 url"], r["origem 3"]);
      await add("OFFICIAL_PAGE", r["pagina oficial"], "Intelbras oficial");
      await add("DATASHEET", r["documentacao oficial"], "Intelbras oficial");
      await tx.product.update({ where: { id: pid }, data: { researchStatus: "NEEDS_REVIEW", suggestedManufacturer: r["fabricante"] ? `${r["fabricante"]}`.slice(0, 120) : undefined } });
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "research.import_preliminary", entityType: "Tenant", entityId: ctx.tenantId, diff: report });
  }, { timeout: 60_000 });
  return report;
}

/**
 * Aprovação em lote: coloca na galeria as imagens OFICIAIS já verificadas
 * (até 3 por produto). Imagens de revendedor continuam aguardando revisão.
 */
export async function bulkApproveOfficialImages(ctx: TenantContext) {
  assertCan(ctx, "research:review");
  assertCan(ctx, "products:write");
  const { approveOfficialImagesFor } = await import("./engine");
  const products = await getDb().researchAsset.findMany({
    where: { tenantId: ctx.tenantId, kind: "IMAGE", status: "CANDIDATE", sourceType: "OFFICIAL", verifiedAt: { not: null }, width: { not: null } },
    distinct: ["productId"],
    select: { productId: true },
  });
  let approved = 0;
  const notes: string[] = [];
  for (const p of products) approved += await approveOfficialImagesFor(ctx, p.productId, notes);
  return { products: products.length, approved, notes: notes.slice(0, 20) };
}
