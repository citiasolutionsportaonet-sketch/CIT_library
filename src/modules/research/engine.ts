import "server-only";
import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { Job, Prisma } from "@/generated/prisma/client";
import { assertCan, type TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { permissionsFor } from "@/server/permissions";
import { FetchBlocked, IMAGE_ACCEPT, politeFetch } from "./http";
import { guessModel, scoreOffer } from "./match";
import { PROVIDERS } from "./providers";
import { approveAsset } from "./service";
import { computeResearchStatus, MAX_IMAGES_PER_PRODUCT } from "./status";
import type { AssetCandidate, OfferCandidate, ResearchProduct } from "./providers/types";

const MIN_IMAGE_SIDE = 300;

export class BudgetExhausted extends Error {}
export class RunNotRunning extends Error {}

async function actorCtx(job: Job): Promise<TenantContext> {
  const m = await getDb().membership.findFirst({
    where: { tenantId: job.tenantId, userId: job.actorId, active: true, user: { active: true }, tenant: { status: "ACTIVE" } },
    include: { tenant: true, user: true },
  });
  if (!m) throw new DomainError("FORBIDDEN", "Quem iniciou a pesquisa não tem mais acesso ativo.");
  const ctx: TenantContext = { tenantId: job.tenantId, tenantSlug: m.tenant.slug, tenantName: m.tenant.name, timezone: m.tenant.timezone, userId: job.actorId, userName: m.user.name, role: m.role, permissions: permissionsFor(m.role), requestId: `job:${job.id}` };
  assertCan(ctx, "research:run");
  return ctx;
}

/**
 * Reserva orçamento de forma atômica (UPDATE condicional). Ao estourar, pausa
 * a execução: nada é gasto além do limite aprovado.
 */
async function reserveBudget(runId: string, calls: number, cents: number) {
  if (calls === 0 && cents === 0) return;
  const n = await getDb().$executeRaw`
    UPDATE "research_run" SET "apiCalls" = "apiCalls" + ${calls}, "costCents" = "costCents" + ${cents}
    WHERE "id" = ${runId}::uuid AND "status" = 'RUNNING'
      AND "apiCalls" + ${calls} <= "maxApiCalls" AND "costCents" + ${cents} <= "maxCostCents"`;
  if (n === 1) return;
  const run = await getDb().researchRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run?.status !== "RUNNING") throw new RunNotRunning("Execução pausada ou cancelada.");
  await getDb().researchRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { status: "PAUSED" } });
  throw new BudgetExhausted("Orçamento da execução atingido; execução pausada.");
}

async function recordUsage(provider: string, calls: number, cents: number) {
  if (!calls) return;
  await getDb().$executeRaw`
    INSERT INTO "provider_usage" ("provider", "day", "calls", "costCents") VALUES (${provider}, CURRENT_DATE, ${calls}, ${cents})
    ON CONFLICT ("provider", "day") DO UPDATE SET "calls" = "provider_usage"."calls" + ${calls}, "costCents" = "provider_usage"."costCents" + ${cents}`;
}

async function dailyCapReached(provider: string): Promise<boolean> {
  const cap = Number(process.env[`${provider.toUpperCase().replace(/-/g, "_")}_DAILY_MAX_CALLS`] ?? 500);
  const u = await getDb().providerUsage.findFirst({ where: { provider, day: new Date(new Date().toISOString().slice(0, 10)) } });
  return (u?.calls ?? 0) >= cap;
}

/** Baixa e valida uma imagem: tipo por conteúdo, decodificação real e tamanho mínimo. */
async function verifyImage(url: string) {
  const res = await politeFetch(url, { maxBytes: 10 * 1024 * 1024, accept: IMAGE_ACCEPT });
  if (res.status !== 200) return { ok: false as const, httpStatus: res.status, note: `HTTP ${res.status}` };
  const ft = await fileTypeFromBuffer(res.body);
  if (!ft || !["image/jpeg", "image/png", "image/webp"].includes(ft.mime)) return { ok: false as const, httpStatus: res.status, note: `Tipo não aceito (${ft?.mime ?? "desconhecido"})` };
  const meta = await sharp(res.body, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  if (!meta.width || !meta.height) return { ok: false as const, httpStatus: res.status, note: "Imagem ilegível" };
  const small = Math.min(meta.width, meta.height) < MIN_IMAGE_SIDE;
  return {
    ok: !small,
    httpStatus: res.status,
    contentType: ft.mime,
    byteSize: res.body.length,
    width: meta.width,
    height: meta.height,
    sha256: createHash("sha256").update(res.body).digest("hex"),
    note: small ? `Imagem pequena (${meta.width}×${meta.height})` : undefined,
  };
}

async function verifyPdf(url: string) {
  const res = await politeFetch(url, { maxBytes: 25 * 1024 * 1024, accept: "application/pdf,*/*;q=0.5", timeoutMs: 45_000 });
  const isPdf = res.status === 200 && res.body.subarray(0, 5).toString("latin1") === "%PDF-";
  return { ok: isPdf, httpStatus: res.status, contentType: isPdf ? "application/pdf" : res.contentType.slice(0, 100), byteSize: res.body.length, sha256: createHash("sha256").update(res.body).digest("hex"), note: isPdf ? undefined : "Não é um PDF válido" };
}

export type ResearchSummary = { images: number; imagesApproved: number; documents: number; offers: number; acceptedOffers: number; pages: number; notes: string[]; paidCalls: number };
export { MAX_IMAGES_PER_PRODUCT };

export async function researchProductJob(job: Job): Promise<ResearchSummary> {
  const ctx = await actorCtx(job);
  const db = getDb();
  const run = await db.researchRun.findFirst({ where: { id: job.runId!, tenantId: ctx.tenantId } });
  if (!run || run.status !== "RUNNING") throw new RunNotRunning("Execução não está ativa.");
  const allowed = new Set(run.providers as string[]);
  const product = await db.product.findFirst({
    where: { id: job.productId!, tenantId: ctx.tenantId },
    include: { brand: true, researchAssets: { where: { kind: "OFFICIAL_PAGE", status: { not: "REJECTED" } }, select: { url: true } } },
  });
  if (!product) throw new DomainError("NOT_FOUND", "Produto não encontrado.");
  await db.product.update({ where: { id: product.id }, data: { researchStatus: "IN_PROGRESS" } });

  const links = (product.links as { url: string }[]) ?? [];
  const p: ResearchProduct = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    brand: product.brand?.name ?? product.suggestedManufacturer ?? null,
    model: product.model ?? product.suggestedModel ?? guessModel(product.name),
    officialPages: [...new Set([...product.researchAssets.map((a) => a.url), ...links.map((l) => l.url)])],
  };
  const summary: ResearchSummary = { images: 0, imagesApproved: 0, documents: 0, offers: 0, acceptedOffers: 0, pages: 0, notes: [], paidCalls: 0 };
  const options = (run.options ?? {}) as { autoApproveOfficialImages?: boolean };
  const assets: AssetCandidate[] = [];
  const offers: OfferCandidate[] = [];
  let fields: { manufacturer?: string; model?: string } = {};

  const runProvider = async (prov: (typeof PROVIDERS)[number]) => {
    if (!allowed.has(prov.id) || !prov.configured()) return;
    if (prov.paid) {
      if (await dailyCapReached(prov.id)) {
        summary.notes.push(`${prov.label}: limite diário atingido`);
        return;
      }
      const planned = prov.plannedCalls(p);
      await reserveBudget(run.id, planned, planned * prov.costPerCallCents());
    }
    const r = await prov.run(p);
    if (prov.paid) await recordUsage(prov.id, r.paidCalls, r.paidCalls * prov.costPerCallCents());
    summary.paidCalls += r.paidCalls;
    assets.push(...r.assets);
    offers.push(...r.offers);
    summary.notes.push(...r.notes);
    if (r.fields) fields = { ...fields, ...r.fields };
  };

  const official = PROVIDERS.find((x) => x.id === "official-site")!;
  // 1) site oficial com páginas já conhecidas; 2) busca de imagens oficiais
  // se faltam fotos; 3) busca licenciada para descobrir páginas; 4) site
  // oficial nas páginas descobertas; 5) marketplace.
  await runProvider(official);
  const goodImages = await db.researchAsset.count({ where: { tenantId: ctx.tenantId, productId: product.id, kind: "IMAGE", status: { in: ["ACCEPTED", "CANDIDATE"] }, verifiedAt: { not: null } } });
  if (goodImages + assets.filter((a) => a.kind === "IMAGE").length < MAX_IMAGES_PER_PRODUCT) {
    await runProvider(PROVIDERS.find((x) => x.id === "brave-images")!);
  }
  if (assets.filter((a) => a.kind === "IMAGE").length === 0 || assets.every((a) => a.kind !== "DATASHEET" && a.kind !== "MANUAL")) {
    const before = assets.length;
    await runProvider(PROVIDERS.find((x) => x.id === "brave-search")!);
    const discovered = assets.slice(before).filter((a) => a.kind === "OFFICIAL_PAGE").map((a) => a.url);
    if (discovered.length) {
      p.officialPages = [...new Set([...p.officialPages, ...discovered])];
      await runProvider(official);
    }
  }
  await runProvider(PROVIDERS.find((x) => x.id === "mercadolivre")!);

  // Validação: imagens e PDFs são baixados e conferidos antes de virar candidatos.
  const now = new Date();
  const existing = new Set(
    (await db.researchAsset.findMany({ where: { tenantId: ctx.tenantId, productId: product.id }, select: { kind: true, url: true } })).map((a) => `${a.kind}|${a.url}`),
  );
  const seenSha = new Set<string>();
  const toSave: Prisma.ResearchAssetCreateManyInput[] = [];
  let validImages = 0;
  for (const a of assets) {
    if (existing.has(`${a.kind}|${a.url}`) || toSave.some((s) => s.kind === a.kind && s.url === a.url)) continue;
    const base = { tenantId: ctx.tenantId, productId: product.id, kind: a.kind, url: a.url.slice(0, 2000), sourceType: a.sourceType, sourceName: a.sourceName.slice(0, 120), title: a.title ?? null, data: (a.data ?? {}) as Prisma.InputJsonValue, origin: "ENGINE" as const, runId: run.id };
    try {
      if (a.kind === "IMAGE") {
        if (validImages >= MAX_IMAGES_PER_PRODUCT) continue;
        const v = await verifyImage(a.url);
        if (v.ok && v.sha256 && seenSha.has(v.sha256)) continue;
        if (v.ok && v.sha256) seenSha.add(v.sha256);
        if (v.ok) validImages++;
        toSave.push({ ...base, httpStatus: v.httpStatus, contentType: v.contentType ?? null, byteSize: v.byteSize ?? null, width: v.width ?? null, height: v.height ?? null, sha256: v.sha256 ?? null, verifiedAt: now, status: v.ok ? "CANDIDATE" : "REJECTED", reviewNote: v.note ?? null });
      } else if (a.kind === "DATASHEET" || a.kind === "MANUAL") {
        const v = await verifyPdf(a.url);
        toSave.push({ ...base, httpStatus: v.httpStatus, contentType: v.contentType, byteSize: v.byteSize, sha256: v.sha256, verifiedAt: now, status: v.ok ? "CANDIDATE" : "REJECTED", reviewNote: v.note ?? null });
      } else {
        toSave.push({ ...base, httpStatus: 200, verifiedAt: now });
      }
    } catch (e) {
      const reason = e instanceof FetchBlocked ? e.message : `Falha: ${(e as Error).message}`.slice(0, 300);
      toSave.push({ ...base, verifiedAt: now, status: "REJECTED", reviewNote: reason });
    }
  }
  // Também verifica candidatos já existentes e ainda não conferidos (ex.: da
  // planilha preliminar): imagem/PDF acessível e válido, ou rejeitado com motivo.
  const unverified = await db.researchAsset.findMany({ where: { tenantId: ctx.tenantId, productId: product.id, verifiedAt: null, status: "CANDIDATE", kind: { in: ["IMAGE", "DATASHEET", "MANUAL"] } } });
  const verifiedUpdates: { id: string; data: Prisma.ResearchAssetUpdateInput }[] = [];
  for (const a of unverified) {
    try {
      const isPdfUrl = /\.pdf(\?|$)/i.test(a.url);
      if (a.kind !== "IMAGE" && !isPdfUrl) {
        // Página de download (HTML), não o arquivo: fica para revisão humana.
        verifiedUpdates.push({ id: a.id, data: { verifiedAt: now, reviewNote: "Link de página de download (não é o PDF direto); confira manualmente." } });
        continue;
      }
      const v = a.kind === "IMAGE" ? await verifyImage(a.url) : await verifyPdf(a.url);
      verifiedUpdates.push({
        id: a.id,
        data: {
          verifiedAt: now,
          httpStatus: v.httpStatus,
          contentType: "contentType" in v ? (v.contentType ?? null) : null,
          byteSize: "byteSize" in v ? (v.byteSize ?? null) : null,
          width: "width" in v ? (v.width ?? null) : null,
          height: "height" in v ? (v.height ?? null) : null,
          sha256: "sha256" in v ? (v.sha256 ?? null) : null,
          ...(v.ok ? { reviewNote: `${a.reviewNote ?? ""} Verificado: acessível e válido.`.trim().slice(0, 500) } : { status: "REJECTED", reviewNote: `Verificação falhou: ${v.note}` }),
        },
      });
    } catch (e) {
      // Bloqueio (robots/403/ritmo) não é prova de inválido: mantém candidato com nota.
      verifiedUpdates.push({ id: a.id, data: { reviewNote: `Não foi possível verificar agora: ${(e as Error).message}`.slice(0, 500) } });
    }
  }

  if (fields.manufacturer || fields.model) {
    toSave.push({ tenantId: ctx.tenantId, productId: product.id, kind: "SPEC", url: p.officialPages[0] ?? "https://invalid.local/", sourceType: "OFFICIAL", sourceName: "dados estruturados da página oficial", data: fields, origin: "ENGINE", runId: run.id, verifiedAt: now });
  }

  const offerRows: Prisma.MarketOfferCreateManyInput[] = offers.map((o) => {
    const m = scoreOffer(o.title, { model: p.model, description: p.name, brand: p.brand }, o.condition);
    return {
      tenantId: ctx.tenantId,
      productId: product.id,
      provider: o.provider,
      sourceName: o.sourceName,
      url: o.url,
      title: o.title,
      price: o.price,
      shipping: o.shipping ?? null,
      currency: o.currency,
      condition: o.condition,
      observedAt: now,
      origin: "ENGINE",
      matchScore: m.score,
      matchReasons: m.reasons,
      // Aceite automático só para correspondência estrita; o resto aguarda revisão.
      status: m.accept ? "ACCEPTED" : "CANDIDATE",
      reviewNote: m.accept ? "Aceite automático: correspondência estrita (modelo, marca, novo)." : null,
      runId: run.id,
    };
  });

  await writeTx(async (tx) => {
    for (const u of verifiedUpdates) await tx.researchAsset.update({ where: { id: u.id }, data: u.data });
    if (toSave.length) await tx.researchAsset.createMany({ data: toSave, skipDuplicates: true });
    if (offerRows.length) await tx.marketOffer.createMany({ data: offerRows, skipDuplicates: true });
    await tx.product.update({
      where: { id: product.id },
      data: {
        researchStatus: await computeResearchStatus(tx, ctx.tenantId, product.id),
        lastResearchAt: now,
        suggestedManufacturer: fields.manufacturer?.slice(0, 120) ?? product.suggestedManufacturer,
        suggestedModel: fields.model?.slice(0, 120) ?? product.suggestedModel ?? p.model,
      },
    });
  }, { timeout: 30_000 });

  // Aprovação automática (opção da execução): só imagens OFICIAIS verificadas,
  // maiores primeiro, até completar 3 por produto. Revendedores nunca.
  if (options.autoApproveOfficialImages) {
    summary.imagesApproved = await approveOfficialImagesFor(ctx, product.id, summary.notes);
    if (summary.imagesApproved) {
      await writeTx(async (tx) => {
        await tx.product.update({ where: { id: product.id }, data: { researchStatus: await computeResearchStatus(tx, ctx.tenantId, product.id) } });
      });
    }
  }
  summary.notes.push(`${verifiedUpdates.length} evidência(s) existente(s) conferida(s).`);
  summary.images = toSave.filter((s) => s.kind === "IMAGE" && s.status === "CANDIDATE").length;
  summary.documents = toSave.filter((s) => (s.kind === "DATASHEET" || s.kind === "MANUAL") && s.status === "CANDIDATE").length;
  summary.pages = toSave.filter((s) => s.kind === "OFFICIAL_PAGE").length;
  summary.offers = offerRows.length;
  summary.acceptedOffers = offerRows.filter((o) => o.status === "ACCEPTED").length;
  return summary;
}


/** Aprova imagens oficiais verificadas de um produto até o limite. Retorna quantas entraram. */
export async function approveOfficialImagesFor(ctx: TenantContext, productId: string, notes: string[] = []): Promise<number> {
  const db = getDb();
  const accepted = await db.researchAsset.count({ where: { tenantId: ctx.tenantId, productId, kind: "IMAGE", status: "ACCEPTED" } });
  const room = MAX_IMAGES_PER_PRODUCT - accepted;
  if (room <= 0) return 0;
  const candidates = await db.researchAsset.findMany({
    where: { tenantId: ctx.tenantId, productId, kind: "IMAGE", status: "CANDIDATE", sourceType: "OFFICIAL", verifiedAt: { not: null }, width: { not: null } },
    orderBy: [{ width: "desc" }, { createdAt: "asc" }],
  });
  const seen = new Set<string>();
  let n = 0;
  for (const c of candidates) {
    if (n >= room) break;
    if (c.sha256 && seen.has(c.sha256)) continue;
    try {
      await approveAsset(ctx, c.id);
      if (c.sha256) seen.add(c.sha256);
      n++;
    } catch (e) {
      notes.push(`Aprovação automática falhou para ${c.url}: ${(e as Error).message}`.slice(0, 300));
    }
  }
  return n;
}
