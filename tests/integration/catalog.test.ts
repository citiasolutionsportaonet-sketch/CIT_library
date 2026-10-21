import { beforeAll, describe, expect, it } from "vitest";
import { exportProductsCsv } from "@/modules/catalog/export";
import { acceptSuggestion, applyBrandProposals, applyCategoryProposals, bulkUpdate, classificationPreview, deleteTaxonomy, fillSuggestedModels, saveCategory, taxonomy } from "@/modules/catalog/service";
import { Decimal } from "@/modules/pricing/calc";
import { recordCost } from "@/modules/pricing/service";
import { createProduct, listProducts } from "@/modules/products/service";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { assertTestDb, makeCtx, makeTenant } from "./helpers";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof DomainError ? e.code : String(e)));
beforeAll(() => assertTestDb());

describe("organização do catálogo", () => {
  it("classifica só quem não tem categoria, cria a hierarquia e é idempotente", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "EDITOR");
    await createProduct(ctx, { name: "Câmera Bullet VIP 1230 B G5", sku: "1" });
    await createProduct(ctx, { name: "GRAVADOR DIG VID INVU 91128", sku: "2" });
    const { id: manual } = await createProduct(ctx, { name: "Câmera Dome VIP 1220", sku: "3", category: "Minha categoria" });
    await createProduct(ctx, { name: "XYZ sem regra", sku: "4" });
    const prev = await classificationPreview(ctx);
    expect(prev.categories.map((c) => [c.path, c.count])).toEqual([
      ["Segurança eletrônica > CFTV > Câmeras", 1],
      ["Segurança eletrônica > CFTV > Gravadores e armazenamento", 1],
    ]);
    expect(prev.unmatched.count).toBe(1);
    expect((await applyCategoryProposals(ctx, prev.categories.map((c) => c.path))).updated).toBe(2);
    expect((await applyCategoryProposals(ctx, prev.categories.map((c) => c.path))).updated).toBe(0);
    const tax = await taxonomy(ctx);
    const cftv = tax.categories.find((c) => c.path === "Segurança eletrônica > CFTV")!;
    expect(cftv.total).toBe(2);
    // filtro pela categoria-mãe inclui subcategorias
    const root = tax.categories.find((c) => c.path === "Segurança eletrônica")!;
    expect((await listProducts(ctx, { categoryId: root.id })).total).toBe(2);
    expect((await getDb().product.findUniqueOrThrow({ where: { id: manual }, include: { category: true } })).category?.name).toBe("Minha categoria");
    // ciclo e exclusão em uso
    expect(await code(saveCategory(ctx, { id: root.id, name: root.name, parentId: cftv.id }))).toBe("CONFLICT");
    expect(await code(deleteTaxonomy(ctx, "category", cftv.id))).toBe("CONFLICT");
  });

  it("marca só quando citada; sugestão de modelo não altera o modelo oficial", async () => {
    const ctx = await makeCtx(await makeTenant(), "OWNER");
    await createProduct(ctx, { name: "ADAPTADOR INTELBRAS USB A/C ADI20", sku: "1" });
    const { id } = await createProduct(ctx, { name: "Câmera Bullet VIP 1230 B G5", sku: "2" });
    expect((await classificationPreview(ctx)).brands.map((b) => b.brand)).toEqual(["Intelbras"]);
    expect((await applyBrandProposals(ctx, ["Intelbras"])).updated).toBe(1);
    expect((await fillSuggestedModels(ctx)).filled).toBe(2);
    const p = await getDb().product.findUniqueOrThrow({ where: { id } });
    expect([p.model, p.suggestedModel, p.brandId]).toEqual([null, "VIP 1230 B G5", null]);
    await acceptSuggestion(ctx, id, "model");
    expect((await getDb().product.findUniqueOrThrow({ where: { id } })).model).toBe("VIP 1230 B G5");
    expect(await code(acceptSuggestion(ctx, id, "manufacturer"))).toBe("CONFLICT"); // sem sugestão
  });

  it("edição em massa: total precisa bater; ativar exige marca e modelo; VIEWER não edita", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "EDITOR");
    const viewer = await makeCtx(t, "VIEWER");
    await createProduct(ctx, { name: "Lote A1", sku: "A1", brand: "Intelbras", model: "M1" });
    await createProduct(ctx, { name: "Lote A2", sku: "A2" });
    const filter = { q: "Lote" };
    expect(await code(bulkUpdate(ctx, filter, { kind: "status", status: "ACTIVE" }, 3))).toBe("CONFLICT");
    expect(await bulkUpdate(ctx, filter, { kind: "status", status: "ACTIVE" }, 2)).toEqual({ updated: 1, skipped: 1 });
    expect(await bulkUpdate(ctx, filter, { kind: "addTag", tag: "Promo" }, 2)).toEqual({ updated: 2, skipped: 0 });
    expect(await bulkUpdate(ctx, filter, { kind: "addTag", tag: "promo" }, 2)).toEqual({ updated: 0, skipped: 2 });
    expect(await code(bulkUpdate(viewer, filter, { kind: "addTag", tag: "x" }, 2))).toBe("FORBIDDEN");
    const ev = await getDb().auditEvent.count({ where: { tenantId: t.id, action: "catalog.bulk_update" } });
    expect(ev).toBe(3);
  });

  it("exportação: custo só com permissão; fórmulas neutralizadas", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const viewer = await makeCtx(t, "VIEWER");
    const { id } = await createProduct(owner, { name: "=HYPERLINK(\"http://x\")", sku: "0001" });
    await recordCost(owner, id, new Decimal("100.10"), new Date(Date.now() - 1000), "x");
    const o = await exportProductsCsv(owner, {});
    expect(o.csv).toContain("Custo distribuidor");
    expect(o.csv).toContain("Markup (%)");
    expect(o.csv).toContain("100,10");
    expect(o.csv).toContain("'=HYPERLINK");
    expect(o.csv).toContain("0001;");
    const v = await exportProductsCsv(viewer, {});
    expect(v.csv).not.toContain("Custo distribuidor");
    expect(v.csv).not.toContain("Markup (%)");
    expect(v.csv).not.toContain("100,10");
    expect(v.csv).toContain("145,15"); // preço CIT visível
    const csvLines = v.csv.trim().split("\r\n");
    expect(csvLines[0].split(";")).toHaveLength(16);
    expect(csvLines[1].split(";")).toHaveLength(16);
    expect(await getDb().auditEvent.count({ where: { tenantId: t.id, action: { startsWith: "export.products" } } })).toBe(2);
  });
});
