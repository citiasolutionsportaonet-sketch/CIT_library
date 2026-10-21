import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticateApi, createCredential, revokeCredential } from "@/modules/api/credentials";
import { apiGetProduct, apiListProducts, apiProductPrices } from "@/modules/api/catalog";
import { applyImportChunk, confirmBatch, createImportBatch, finishBatchIfDone } from "@/modules/imports/service";
import { Decimal } from "@/modules/pricing/calc";
import { currentPrices, ensureCostList, pricingFor, recordCost, updateMarkup } from "@/modules/pricing/service";
import { BudgetExhausted, researchProductJob } from "@/modules/research/engine";
import { controlRun, createRun, reviewOffer } from "@/modules/research/service";
import { createProduct } from "@/modules/products/service";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { claimNext, completeJob, enqueueMany, recoverExpired } from "@/server/jobs/queue";
import { assertTestDb, makeCtx, makeTenant } from "./helpers";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof DomainError ? e.code : String(e)));

function xlsx(rows: (string | number)[][]) {
  const shared: string[] = [];
  const si = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const cols = "ABC";
  const body = rows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => (typeof v === "number" ? `<c r="${cols[j]}${i + 1}"><v>${v}</v></c>` : `<c r="${cols[j]}${i + 1}" t="s"><v>${si(v)}</v></c>`)).join("")}</row>`)
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${body}</sheetData></worksheet>`),
  });
}
const HEADER = ["Código Produto", "Descrição do Produto", "PREÇO"];

async function runAllJobs(worker = "test") {
  for (;;) {
    const j = await claimNext(worker);
    if (!j) return;
    const r = await applyImportChunk(j);
    await completeJob(j.id, worker, r);
    await finishBatchIfDone(j.tenantId, j.batchId!, j.actorId, "t");
  }
}

beforeAll(() => assertTestDb());

describe("importação do distribuidor", () => {
  it("prévia não grava; confirmação aplica; custo zero vira ausente; reenvio bloqueado", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "EDITOR");
    const file = xlsx([HEADER, ["0004001", "Câmera X", 100.5], ["4002", "Cabo", 0], ["4003", "Licença", 123.45000000000002]]);
    const { batchId, counters } = await createImportBatch(ctx, { bytes: file, fileName: "t.xlsx", supplier: "Dist" });
    expect(counters).toMatchObject({ total: 3, valid: 3, withCost: 2, withoutCost: 1 });
    expect(await getDb().product.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await code(createImportBatch(ctx, { bytes: file, fileName: "t.xlsx", supplier: "Dist" }))).toBe("CONFLICT");

    await confirmBatch(ctx, batchId, { effectiveDate: "2026-10-21", updateNames: false });
    await runAllJobs();
    const products = await getDb().product.findMany({ where: { tenantId: t.id }, orderBy: { sku: "asc" } });
    expect(products.map((p) => [p.sku, p.status])).toEqual([["0004001", "DRAFT"], ["4002", "DRAFT"], ["4003", "DRAFT"]]);
    const prices = await getDb().priceEntry.findMany({ where: { tenantId: t.id }, orderBy: { amount: "asc" } });
    expect(prices.map((p) => p.amount.toFixed(2))).toEqual(["100.50", "123.45"]);
    expect(prices[0].effectiveAt.toISOString()).toBe("2026-10-21T03:00:00.000Z"); // 00:00 em São Paulo
    const b = await getDb().importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(b.status).toBe("COMPLETED");

    // Reprocessar os mesmos jobs (simula retomada) não duplica.
    await getDb().job.updateMany({ where: { batchId }, data: { status: "QUEUED", attempts: 0 } });
    await runAllJobs();
    expect(await getDb().priceEntry.count({ where: { tenantId: t.id } })).toBe(2);
  });

  it("códigos repetidos no arquivo viram conflito e nenhum é aplicado", async () => {
    const ctx = await makeCtx(await makeTenant(), "OWNER");
    const { counters } = await createImportBatch(ctx, { bytes: xlsx([HEADER, ["1", "A", 1], ["1", "B", 2], ["2", "C", 3]]), fileName: "d.xlsx", supplier: "Dist" });
    expect(counters).toMatchObject({ conflict: 2, valid: 1 });
  });

  it("VIEWER não importa", async () => {
    const t = await makeTenant();
    const viewer = await makeCtx(t, "VIEWER");
    expect(await code(createImportBatch(viewer, { bytes: xlsx([HEADER, ["1", "A", 1]]), fileName: "v.xlsx", supplier: "Dist" }))).toBe("FORBIDDEN");
  });
});

describe("preço vigente e custo", () => {
  it("maior vigência <= agora vence; futuro não substitui; desempate por registro", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    const { id } = await createProduct(ctx, { name: "P", sku: "P1" });
    const past = new Date(Date.now() - 86400_000);
    await recordCost(ctx, id, new Decimal(100), past, "inicial");
    await recordCost(ctx, id, new Decimal(90), past, "correção mesma vigência");
    await recordCost(ctx, id, new Decimal(500), new Date(Date.now() + 86400_000), "futuro");
    const list = await getDb().priceList.findFirstOrThrow({ where: { tenantId: t.id, kind: "COST" } });
    expect((await currentPrices(t.id, list.id, [id])).get(id)?.toFixed(2)).toBe("90.00");
    expect(await code(getDb().priceEntry.updateMany({ where: { productId: id }, data: { amount: 1 } }))).not.toBe("ok"); // append-only
  });

  it("markup limitado a 45%; Preço CIT recalcula; VIEWER não recebe custo", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const viewer = await makeCtx(t, "VIEWER");
    const { id } = await createProduct(owner, { name: "P", sku: "P1" });
    await recordCost(owner, id, new Decimal("278.50"), new Date(Date.now() - 1000), "x");
    expect((await pricingFor(owner, [id])).get(id)).toMatchObject({ cost: "278.50", markupPct: "45.00", citPrice: "403.83" });
    expect(await code(updateMarkup(owner, "46"))).toBe("VALIDATION");
    expect(await code(updateMarkup(viewer, "10"))).toBe("FORBIDDEN");
    await updateMarkup(owner, "20");
    const v = (await pricingFor(viewer, [id])).get(id)!;
    expect(v.citPrice).toBe("334.20");
    expect(v.cost).toBeNull();
    expect(v.markupPct).toBeNull();
    expect(JSON.stringify(v)).not.toContain("278.5");
    expect((await pricingFor(owner, [id], { forceHideCost: true })).get(id)).toMatchObject({ cost: null, markupPct: null, citPrice: "334.20" });
  });

  it("oferta de página de busca nunca entra na mediana", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    const { id } = await createProduct(ctx, { name: "P", sku: "P1" });
    const o = await getDb().marketOffer.create({ data: { tenantId: t.id, productId: id, provider: "x", sourceName: "ML", url: "https://lista.mercadolivre.com.br/x", title: "x", price: "10", observedAt: new Date(), origin: "IMPORT_PRELIMINARY", isListingPage: true } });
    expect(await code(reviewOffer(ctx, o.id, "ACCEPTED"))).toBe("CONFLICT");
    expect((await pricingFor(ctx, [id])).get(id)?.marketMedian).toBeNull();
  });
});

describe("fila persistente", () => {
  it("dois workers nunca pegam o mesmo job; lease vencida é recuperada", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    await enqueueMany(Array.from({ length: 6 }, () => ({ tenantId: t.id, type: "IMPORT_APPLY" as const, actorId: ctx.userId, batchId: null })));
    const claimed = await Promise.all(Array.from({ length: 10 }, (_, i) => claimNext(`w${i % 2}`)));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    const mine = ids.filter((id) => id); // pode incluir jobs de outros testes; checamos duplicidade
    expect(new Set(mine).size).toBe(mine.length);
    await getDb().job.updateMany({ where: { id: { in: ids } }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    expect(await recoverExpired()).toBeGreaterThanOrEqual(ids.length);
    await getDb().job.updateMany({ where: { tenantId: t.id }, data: { status: "CANCELED" } });
  });

  it("orçamento esgotado pausa a execução sem chamar provedor pago", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    await createProduct(ctx, { name: "Câmera VIP 1230 B G5", sku: "C1" });
    process.env.BRAVE_SEARCH_API_KEY = "teste-sem-uso";
    process.env.BRAVE_COST_CENTS_PER_CALL = "5";
    const run = await createRun(ctx, { limit: 1, providers: ["brave-search"], maxApiCalls: 0, maxCostCents: 0 });
    const job = await claimNext("w-budget");
    expect(job?.runId).toBe(run.id);
    await expect(researchProductJob(job!)).rejects.toBeInstanceOf(BudgetExhausted);
    expect((await getDb().researchRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("PAUSED");
    expect(await getDb().providerUsage.count({ where: { provider: "brave-search" } })).toBe(0);
    expect(await code(controlRun(ctx, run.id, "resume"))).toBe("CONFLICT"); // não retoma sem orçamento
    await controlRun(ctx, run.id, "cancel");
    delete process.env.BRAVE_SEARCH_API_KEY;
    expect(await code(createRun(ctx, { limit: 1, providers: ["brave-search"], maxApiCalls: 1, maxCostCents: 1 }))).toBe("VALIDATION"); // sem credencial
  });

  it("pesquisa sem achados não apaga pendência preliminar (situação considera todas as evidências)", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    const { id } = await createProduct(ctx, { name: "Telefone TOK FACIL", sku: "T1" });
    await getDb().researchAsset.create({ data: { tenantId: t.id, productId: id, kind: "IMAGE", url: "https://exemplo.invalid/a.jpg", sourceType: "RESELLER", sourceName: "planilha", origin: "IMPORT_PRELIMINARY" } });
    await createRun(ctx, { productIds: [id], limit: 1, providers: ["official-site"], maxApiCalls: 0, maxCostCents: 0 });
    const job = await claimNext("w-status");
    const r = await researchProductJob(job!);
    expect(r.notes.join(" ")).toMatch(/Sem página oficial/);
    expect((await getDb().product.findUniqueOrThrow({ where: { id } })).researchStatus).toBe("NEEDS_REVIEW");
    await completeJob(job!.id, "w-status");
  });

  it("EDITOR não dispara pesquisa paga", async () => {
    const editor = await makeCtx(await makeTenant(), "EDITOR");
    expect(await code(createRun(editor, { limit: 1, providers: ["official-site"], maxApiCalls: 0, maxCostCents: 0 }))).toBe("FORBIDDEN");
  });
});

describe("API v1", () => {
  const req = (token?: string) => new Request("http://x/api/v1/products", { headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("credencial por tenant, escopos e revogação", async () => {
    const ta = await makeTenant();
    const tb = await makeTenant();
    const a = await makeCtx(ta, "OWNER");
    const b = await makeCtx(tb, "OWNER");
    const admin = await makeCtx(ta, "ADMIN");
    expect(await code(createCredential(admin, { name: "X", scopes: ["catalog:read"] }))).toBe("FORBIDDEN");
    const { id: pa } = await createProduct(a, { name: "Produto A", sku: "A1" });
    await recordCost(a, pa, new Decimal(100), new Date(Date.now() - 1000), "x");
    const { id: pb } = await createProduct(b, { name: "Produto B", sku: "B1" });

    const basic = await createCredential(a, { name: "CitCondo", scopes: ["catalog:read", "prices:read"] });
    const stored = await getDb().apiCredential.findUniqueOrThrow({ where: { id: basic.id } });
    expect(stored.tokenHash).not.toContain(basic.token.split("_")[2]);

    const p = await authenticateApi(req(basic.token), "r");
    const list = await apiListProducts(p, new URL("http://x/api/v1/products"));
    expect(list.data.map((d) => d.sku)).toEqual(["A1"]);
    expect(list.data[0].pricing).toMatchObject({ citPrice: "145.00" });
    expect(JSON.stringify(list)).not.toContain("distributorCost");
    expect(list.data[0].pricing).not.toHaveProperty("markupPercent");
    expect((await apiGetProduct(p, pa)).data.pricing).not.toHaveProperty("markupPercent");
    expect(await code(apiGetProduct(p, pb))).toBe("NOT_FOUND"); // outro tenant
    expect((await apiProductPrices(p, pa)).data.pricing).not.toHaveProperty("distributorCost");
    expect((await apiProductPrices(p, pa)).data.pricing).not.toHaveProperty("markupPercent");

    const internal = await createCredential(a, { name: "SysGuard", scopes: ["catalog:read", "costs:read", "prices:read"] });
    const pi = await authenticateApi(req(internal.token), "r");
    expect((await apiGetProduct(pi, pa)).data.pricing).toMatchObject({ distributorCost: "100.00", markupPercent: "45.00", citPrice: "145.00" });

    expect(await code(authenticateApi(req(), "r"))).toBe("UNAUTHENTICATED");
    expect(await code(authenticateApi(req(basic.token.slice(0, -1) + "x"), "r"))).toBe("UNAUTHENTICATED");
    await revokeCredential(a, basic.id);
    expect(await code(authenticateApi(req(basic.token), "r"))).toBe("UNAUTHENTICATED");
  });

  it("ensureCostList é idempotente", async () => {
    const t = await makeTenant();
    await getDb().$transaction(async (tx) => {
      await ensureCostList(tx, t.id, "A");
      await ensureCostList(tx, t.id, "A");
    });
    expect(await getDb().priceList.count({ where: { tenantId: t.id } })).toBe(1);
  });
});
