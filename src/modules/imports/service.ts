import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ImportRowStatus, Job, Prisma } from "@/generated/prisma/client";
import { cleanText, normalizeCode, normalizeName } from "@/lib/normalize";
import { parseSheetAmount } from "@/modules/pricing/calc";
import { ensureCostList } from "@/modules/pricing/service";
import { audit } from "@/server/audit";
import { assertCan, type TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { DomainError, notFound, validation } from "@/server/errors";
import { enqueueMany } from "@/server/jobs/queue";
import { writeTx } from "@/server/maintenance";
import { permissionsFor } from "@/server/permissions";
import { getStorage } from "@/server/storage";
import { readXlsx, XlsxError } from "./xlsx";

export const PARSER_VERSION = "cit-xlsx-1";
export const ROWS_PER_JOB = 200;
const HIGH_COST_WARNING = 100_000;

/** Perfis de mapeamento conhecidos (cabeçalho normalizado → campo). */
export const PROFILES = {
  "distribuidor-v1": {
    label: "Tabela do distribuidor (código, descrição, preço de custo)",
    columns: { code: ["codigo produto", "codigo original", "codigo"], name: ["descricao do produto", "descricao original", "descricao"], cost: ["preco", "custo distribuidor (r$)", "custo"] },
  },
} as const;
type ProfileId = keyof typeof PROFILES;

export type NormalizedRow = { sku: string; name: string; description: string | null; cost: string | null };

/** Nome até 200 caracteres cortado em palavra; o texto completo vai para a descrição. */
export function splitLongName(text: string): { name: string; description: string | null } {
  if (text.length <= 200) return { name: text, description: null };
  const cut = text.slice(0, 199);
  const at = cut.lastIndexOf(" ");
  return { name: `${(at > 120 ? cut.slice(0, at) : cut).trimEnd()}…`, description: text.slice(0, 20_000) };
}

// ---------------------------------------------------------------------------
// 1–4. Envio, normalização e prévia (nada é gravado no catálogo)
// ---------------------------------------------------------------------------

export async function createImportBatch(
  ctx: TenantContext,
  input: { bytes: Uint8Array; fileName: string; supplier: string; sheetName?: string; justification?: string },
) {
  assertCan(ctx, "imports:write");
  const supplier = cleanText(input.supplier || "").slice(0, 120);
  if (!supplier) throw validation({ supplier: "Informe o fornecedor/distribuidor." });
  if (!/\.xlsx$/i.test(input.fileName)) throw validation({ file: "Envie um arquivo .xlsx (CSV entra numa próxima versão)." });
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const db = getDb();

  const previous = await db.importBatch.findFirst({
    where: { tenantId: ctx.tenantId, sha256, supplier, status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true },
  });
  if (previous && !input.justification?.trim()) {
    throw new DomainError("CONFLICT", `Este mesmo arquivo já foi enviado (lote ${previous.id.slice(0, 8)}, ${previous.status}). Abra o lote anterior ou informe uma justificativa para reprocessar.`, {
      previousBatchId: previous.id,
    });
  }

  let parsed;
  try {
    parsed = readXlsx(input.bytes, { sheetName: input.sheetName });
  } catch (e) {
    if (e instanceof XlsxError) throw validation({ file: e.message }, e.message);
    throw e;
  }
  const [header, ...dataRows] = parsed.sheet.rows;
  if (!header) throw validation({ file: "Planilha vazia." });
  const headerNames = Array.from(header.cells, (c) => normalizeName(c?.value ?? ""));
  const { profile, mapping } = detectProfile(headerNames);

  // Normalização e validação linha a linha.
  const existing = new Map(
    (await db.product.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, normalizedSku: true, name: true } })).map((p) => [p.normalizedSku, p]),
  );
  const seen = new Map<string, number[]>();
  const rows = dataRows
    .filter((r) => r.cells.some((c) => c && c.value.trim() !== ""))
    .map((r) => {
      const cell = (k: keyof typeof mapping) => r.cells[mapping[k]] ?? null;
      const errors: string[] = [];
      const warnings: string[] = [];
      for (const k of ["code", "name", "cost"] as const) {
        if (cell(k)?.formula) errors.push(`Coluna "${k === "code" ? "código" : k === "name" ? "descrição" : "custo"}" contém fórmula; exporte a planilha com valores.`);
      }
      const sku = cleanText(cell("code")?.value ?? "");
      const fullName = cleanText(cell("name")?.value ?? "");
      const { name, description } = splitLongName(fullName);
      if (!sku) errors.push("Código vazio.");
      else if (sku.length > 80) errors.push("Código com mais de 80 caracteres.");
      if (!fullName) errors.push("Descrição vazia.");
      else if (description) warnings.push(`Descrição com ${fullName.length} caracteres: nome resumido e texto completo guardado em Descrição.`);
      const amount = parseSheetAmount(cell("cost")?.value ?? "");
      if (amount.error) errors.push(amount.error);
      if (amount.warning) warnings.push(amount.warning);
      let cost = amount.value;
      if (cost && cost.isZero()) {
        warnings.push("Custo zero tratado como ausente: produto importado sem custo.");
        cost = null;
      }
      if (cost && cost.greaterThan(HIGH_COST_WARNING)) warnings.push(`Custo acima de R$ ${HIGH_COST_WARNING.toLocaleString("pt-BR")}: confira.`);
      const key = normalizeCode(sku);
      if (sku) seen.set(key, [...(seen.get(key) ?? []), r.rowNumber]);
      const match = existing.get(key);
      return {
        rowNumber: r.rowNumber,
        raw: Object.fromEntries(Array.from(header.cells, (h, i) => [h?.value || `col${i + 1}`, r.cells[i]?.value ?? ""])),
        normalized: { sku, name, description, cost: cost?.toString() ?? null } satisfies NormalizedRow,
        errors,
        warnings,
        key,
        matchedProductId: match?.id ?? null,
        action: errors.length ? null : match ? (match.name !== name ? "UPDATE" : "MATCH") : "CREATE",
      };
    });

  // Códigos repetidos no arquivo exigem resolução: nenhum é escolhido em silêncio.
  for (const r of rows) {
    const dup = seen.get(r.key);
    if (dup && dup.length > 1) r.errors.push(`Código repetido no arquivo (linhas ${dup.join(", ")}).`);
  }
  const statusOf = (r: (typeof rows)[number]): ImportRowStatus =>
    r.errors.some((e) => e.startsWith("Código repetido")) ? "CONFLICT" : r.errors.length ? "INVALID" : "VALID";

  const counters = {
    total: rows.length,
    valid: rows.filter((r) => statusOf(r) === "VALID").length,
    invalid: rows.filter((r) => statusOf(r) === "INVALID").length,
    conflict: rows.filter((r) => statusOf(r) === "CONFLICT").length,
    create: rows.filter((r) => statusOf(r) === "VALID" && r.action === "CREATE").length,
    existing: rows.filter((r) => statusOf(r) === "VALID" && r.action !== "CREATE").length,
    withCost: rows.filter((r) => statusOf(r) === "VALID" && r.normalized.cost !== null).length,
    withoutCost: rows.filter((r) => statusOf(r) === "VALID" && r.normalized.cost === null).length,
    warnings: rows.filter((r) => r.warnings.length > 0).length,
    applied: 0,
    skipped: 0,
    failed: 0,
  };

  const batchId = randomUUID();
  const storageKey = `${ctx.tenantId}/imports/${batchId}.xlsx`;
  const storage = await getStorage();
  await storage.put(storageKey, Buffer.from(input.bytes));
  try {
    await writeTx(async (tx) => {
      await tx.importBatch.create({
        data: {
          id: batchId,
          tenantId: ctx.tenantId,
          supplier,
          profile,
          fileName: input.fileName.slice(0, 200),
          sha256,
          storageKey,
          mapping: { sheet: parsed.sheet.name, sheets: parsed.sheetNames, columns: mapping },
          parserVersion: PARSER_VERSION,
          counters,
          justification: input.justification?.trim() || null,
          createdById: ctx.userId,
        },
      });
      for (let i = 0; i < rows.length; i += 500) {
        await tx.importRow.createMany({
          data: rows.slice(i, i + 500).map((r) => ({
            tenantId: ctx.tenantId,
            batchId,
            rowNumber: r.rowNumber,
            raw: r.raw,
            normalized: r.normalized,
            errors: r.errors,
            warnings: r.warnings,
            status: statusOf(r),
            action: r.action,
            matchedProductId: r.matchedProductId,
          })),
        });
      }
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "import.create", entityType: "ImportBatch", entityId: batchId, diff: { fileName: input.fileName, supplier, sha256, counters } });
    }, { timeout: 60_000 });
  } catch (e) {
    await storage.delete(storageKey).catch(() => {});
    throw e;
  }
  return { batchId, counters };
}

function detectProfile(headerNames: string[]): { profile: ProfileId; mapping: { code: number; name: number; cost: number } } {
  for (const [id, p] of Object.entries(PROFILES) as [ProfileId, (typeof PROFILES)[ProfileId]][]) {
    const find = (alts: readonly string[]) => headerNames.findIndex((h) => alts.includes(h));
    const mapping = { code: find(p.columns.code), name: find(p.columns.name), cost: find(p.columns.cost) };
    if (mapping.code >= 0 && mapping.name >= 0 && mapping.cost >= 0) return { profile: id, mapping };
  }
  throw validation({ file: "Cabeçalho não reconhecido. Esperado: Código Produto, Descrição do Produto, PREÇO." });
}

export async function listBatches(ctx: TenantContext) {
  assertCan(ctx, "imports:write");
  return getDb().importBatch.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, fileName: true, supplier: true, status: true, counters: true, createdAt: true, effectiveAt: true, completedAt: true },
  });
}

export async function getBatch(ctx: TenantContext, batchId: string, opts: { status?: ImportRowStatus; page?: number; withWarnings?: boolean } = {}) {
  assertCan(ctx, "imports:write");
  const db = getDb();
  const batch = await db.importBatch.findFirst({ where: { id: batchId, tenantId: ctx.tenantId } });
  if (!batch) throw notFound("Lote");
  const where: Prisma.ImportRowWhereInput = { tenantId: ctx.tenantId, batchId };
  if (opts.status) where.status = opts.status;
  if (opts.withWarnings) where.NOT = { warnings: { equals: [] } };
  const page = Math.max(1, opts.page ?? 1);
  const [total, rows, jobs] = await Promise.all([
    db.importRow.count({ where }),
    db.importRow.findMany({ where, orderBy: { rowNumber: "asc" }, skip: (page - 1) * 50, take: 50 }),
    db.job.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId, batchId }, _count: true }),
  ]);
  return { batch, rows, total, page, pageCount: Math.max(1, Math.ceil(total / 50)), jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count])) };
}

// ---------------------------------------------------------------------------
// 5. Confirmação
// ---------------------------------------------------------------------------

/** Início do dia (00:00) de uma data AAAA-MM-DD no fuso informado, em UTC. */
export function startOfDayInTz(date: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validation({ effectiveDate: "Data inválida." });
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  if (guess.getUTCMonth() !== m - 1 || guess.getUTCDate() !== d) throw validation({ effectiveDate: "Data inválida." });
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const mm = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  const minutes = mm ? (mm[1] === "-" ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3])) : 0;
  return new Date(Date.UTC(y, m - 1, d) - minutes * 60_000);
}

export async function confirmBatch(ctx: TenantContext, batchId: string, input: { effectiveDate: string; updateNames: boolean }) {
  assertCan(ctx, "imports:write");
  const effectiveAt = startOfDayInTz(input.effectiveDate, ctx.timezone);
  return writeTx(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text FROM "import_batch" WHERE "id" = ${batchId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw notFound("Lote");
    if (rows[0].status !== "PARSED") throw new DomainError("CONFLICT", "Este lote já foi confirmado ou cancelado.");
    const valid = await tx.importRow.findMany({ where: { tenantId: ctx.tenantId, batchId, status: "VALID" }, orderBy: { rowNumber: "asc" }, select: { rowNumber: true } });
    if (valid.length === 0) throw new DomainError("CONFLICT", "Nenhuma linha válida para aplicar.");
    await tx.importBatch.update({
      where: { id: batchId },
      data: { status: "CONFIRMED", confirmedAt: new Date(), effectiveAt, updatePolicy: { updateNames: !!input.updateNames, emptyNeverClears: true, createAsDraft: true, archiveMissing: false } },
    });
    const jobs = [];
    for (let i = 0; i < valid.length; i += ROWS_PER_JOB) {
      const chunk = valid.slice(i, i + ROWS_PER_JOB);
      jobs.push({ tenantId: ctx.tenantId, type: "IMPORT_APPLY" as const, actorId: ctx.userId, batchId, payload: { fromRow: chunk[0].rowNumber, toRow: chunk[chunk.length - 1].rowNumber }, maxAttempts: 5 });
    }
    await enqueueMany(jobs, tx);
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "import.confirm", entityType: "ImportBatch", entityId: batchId, diff: { effectiveAt: effectiveAt.toISOString(), updateNames: !!input.updateNames, jobs: jobs.length } });
    return { jobs: jobs.length, effectiveAt };
  });
}

export async function cancelBatch(ctx: TenantContext, batchId: string) {
  assertCan(ctx, "imports:write");
  await writeTx(async (tx) => {
    const b = await tx.importBatch.findFirst({ where: { id: batchId, tenantId: ctx.tenantId } });
    if (!b) throw notFound("Lote");
    if (b.status === "COMPLETED" || b.status === "CANCELED") throw new DomainError("CONFLICT", "Lote já finalizado.");
    await tx.job.updateMany({ where: { tenantId: ctx.tenantId, batchId, status: "QUEUED" }, data: { status: "CANCELED", finishedAt: new Date() } });
    await tx.importBatch.update({ where: { id: b.id }, data: { status: "CANCELED", completedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "import.cancel", entityType: "ImportBatch", entityId: b.id });
  });
}

// ---------------------------------------------------------------------------
// 6. Aplicação (executada pelo worker)
// ---------------------------------------------------------------------------

/** Revalida, no momento da execução, que o autor ainda pode importar. */
async function actorContext(tenantId: string, actorId: string, requestId: string): Promise<TenantContext> {
  const m = await getDb().membership.findFirst({
    where: { tenantId, userId: actorId, active: true, user: { active: true }, tenant: { status: "ACTIVE" } },
    include: { tenant: true, user: true },
  });
  if (!m) throw new DomainError("FORBIDDEN", "Autor do lote não tem mais acesso ativo à organização.");
  const ctx: TenantContext = {
    tenantId,
    tenantSlug: m.tenant.slug,
    tenantName: m.tenant.name,
    timezone: m.tenant.timezone,
    userId: actorId,
    userName: m.user.name,
    role: m.role,
    permissions: permissionsFor(m.role),
    requestId,
  };
  assertCan(ctx, "imports:write");
  return ctx;
}

export async function applyImportChunk(job: Job): Promise<{ applied: number; skipped: number }> {
  const db = getDb();
  const ctx = await actorContext(job.tenantId, job.actorId, `job:${job.id}`);
  const batch = await db.importBatch.findFirst({ where: { id: job.batchId!, tenantId: ctx.tenantId } });
  if (!batch) throw new DomainError("NOT_FOUND", "Lote não encontrado.");
  if (batch.status === "CANCELED") return { applied: 0, skipped: 0 };
  if (batch.status === "CONFIRMED") await db.importBatch.updateMany({ where: { id: batch.id, status: "CONFIRMED" }, data: { status: "APPLYING", startedAt: new Date() } });
  const { fromRow, toRow } = job.payload as { fromRow: number; toRow: number };
  const policy = batch.updatePolicy as { updateNames?: boolean };
  const rows = await db.importRow.findMany({
    where: { tenantId: ctx.tenantId, batchId: batch.id, status: "VALID", appliedAt: null, rowNumber: { gte: fromRow, lte: toRow } },
    orderBy: { rowNumber: "asc" },
  });
  let applied = 0;
  let skipped = 0;
  for (const row of rows) {
    const n = row.normalized as NormalizedRow;
    // Uma transação pequena por linha: falha isolada não afeta as demais.
    const outcome = await writeTx(async (tx) => {
      const fresh = await tx.importRow.findUnique({ where: { id: row.id }, select: { appliedAt: true } });
      if (fresh?.appliedAt) return "skip" as const; // idempotência na retomada
      const normalizedSku = normalizeCode(n.sku);
      let product = await tx.product.findUnique({ where: { tenantId_normalizedSku: { tenantId: ctx.tenantId, normalizedSku } }, select: { id: true, name: true } });
      const actions: string[] = [];
      if (!product) {
        product = await tx.product.create({
          data: { tenantId: ctx.tenantId, sku: n.sku, normalizedSku, name: n.name, description: n.description ?? null, status: "DRAFT", createdById: ctx.userId, updatedById: ctx.userId },
          select: { id: true, name: true },
        });
        actions.push("produto criado (rascunho)");
      } else if (policy.updateNames && n.name && product.name !== n.name) {
        await tx.product.update({ where: { id: product.id }, data: { name: n.name, version: { increment: 1 }, updatedById: ctx.userId, updatedAt: new Date() } });
        actions.push("descrição atualizada");
      }
      if (n.cost !== null) {
        const list = await ensureCostList(tx, ctx.tenantId, batch.supplier);
        const same = await tx.priceEntry.findFirst({
          where: { tenantId: ctx.tenantId, productId: product.id, priceListId: list.id, effectiveAt: batch.effectiveAt!, amount: n.cost },
          select: { id: true },
        });
        if (same) actions.push("custo idêntico já registrado nesta vigência");
        else {
          await tx.priceEntry.create({
            data: { tenantId: ctx.tenantId, productId: product.id, priceListId: list.id, amount: n.cost, currency: "BRL", effectiveAt: batch.effectiveAt!, source: "IMPORT", importRowId: row.id, createdById: ctx.userId },
          });
          actions.push("custo registrado");
        }
      } else actions.push("sem custo");
      await tx.importRow.update({ where: { id: row.id }, data: { status: "APPLIED", appliedAt: new Date(), matchedProductId: product.id, action: actions.join("; ") } });
      return "applied" as const;
    });
    if (outcome === "applied") applied++;
    else skipped++;
  }
  return { applied, skipped };
}

/**
 * Chamado pelo worker DEPOIS de marcar o job como concluído/falho. O lock no
 * lote serializa jobs que terminam juntos; o último fecha o lote.
 */
export async function finishBatchIfDone(tenantId: string, batchId: string, actorId: string, requestId: string) {
  await writeTx(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "import_batch" WHERE "id" = ${batchId}::uuid FOR UPDATE`;
    const pending = await tx.job.count({ where: { tenantId, batchId, status: { in: ["QUEUED", "RUNNING"] } } });
    if (pending > 0) return;
    const b = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!b || b.status === "COMPLETED" || b.status === "CANCELED") return;
    const grouped = await tx.importRow.groupBy({ by: ["status"], where: { tenantId, batchId }, _count: true });
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
    const counters = { ...(b.counters as Record<string, number>), applied: by.APPLIED ?? 0, notApplied: by.VALID ?? 0 };
    await tx.importBatch.update({ where: { id: batchId }, data: { status: (by.VALID ?? 0) > 0 ? "FAILED" : "COMPLETED", completedAt: new Date(), counters } });
    await audit(tx, { tenantId, actorId, requestId, action: "import.complete", entityType: "ImportBatch", entityId: batchId, diff: { counters } });
  });
}
