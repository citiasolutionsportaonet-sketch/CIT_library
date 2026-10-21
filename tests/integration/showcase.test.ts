import { beforeAll, describe, expect, it } from "vitest";
import { Decimal } from "@/modules/pricing/calc";
import { recordCost } from "@/modules/pricing/service";
import { createProduct, setArchived } from "@/modules/products/service";
import { loadShowcase } from "@/modules/showcase/service";
import { assertTestDb, makeCtx, makeTenant } from "./helpers";

beforeAll(() => assertTestDb());

describe("vitrine e visão do banco", () => {
  it("consulta dados reais do tenant, sem custos, markup, contas ou notas internas", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const viewer = await makeCtx(t, "VIEWER");
    const a = await createProduct(owner, {
      name: "Câmera Alpha",
      sku: "0001",
      brand: "Marca A",
      model: "A1",
      category: "Segurança",
      status: "ACTIVE",
      internalNotes: "NOTA_PRIVADA_NAO_EXPORTAR",
    });
    await createProduct(owner, { name: "Telefone Beta", sku: "0002" });
    const old = await createProduct(owner, { name: "Arquivado", sku: "0003" });
    await setArchived(owner, old.id, 1, true);
    await recordCost(
      owner,
      a.id,
      new Decimal("314.1592"),
      new Date(Date.now() - 1000),
      "teste",
    );
    const other = await makeCtx(await makeTenant(), "OWNER");
    await createProduct(other, {
      name: "PRODUTO_DE_OUTRA_EMPRESA",
      sku: "9999",
    });

    for (const ctx of [owner, viewer]) {
      const data = await loadShowcase(ctx);
      expect(data.stats).toEqual({
        total: 2,
        withPhoto: 0,
        withPrice: 1,
        withBrand: 1,
        withModel: 1,
        active: 1,
        drafts: 1,
      });
      expect(data.products.find((p) => p.id === a.id)?.price).toBe("455.53");
      expect(data.categories.map((c) => [c.name, c.count])).toEqual([
        ["Segurança", 1],
        ["Sem categoria", 1],
      ]);
      const json = JSON.stringify(data);
      for (const secret of [
        "314.1592",
        "NOTA_PRIVADA_NAO_EXPORTAR",
        "PRODUTO_DE_OUTRA_EMPRESA",
        "markup",
        "password",
        "token",
        "email",
      ])
        expect(json).not.toContain(secret);
    }
  });

  it("busca, categoria e paginação são aplicadas no servidor", async () => {
    const ctx = await makeCtx(await makeTenant(), "OWNER");
    for (let i = 0; i < 26; i++)
      await createProduct(ctx, {
        name: `Produto ${String(i).padStart(2, "0")}`,
        sku: String(i),
        category: i < 2 ? "Câmeras" : "Telefonia",
      });
    const all = await loadShowcase(ctx, { sort: "nome" });
    expect([all.total, all.products.length, all.pageCount]).toEqual([
      26, 24, 2,
    ]);
    const category = all.categories.find((c) => c.name === "Câmeras")!;
    expect((await loadShowcase(ctx, { category: category.id })).total).toBe(2);
    expect(
      (await loadShowcase(ctx, { q: "Produto 25" })).products.map((p) => p.sku),
    ).toEqual(["25"]);
    expect(
      (await loadShowcase(ctx, { page: 999, sort: "nome" })).products,
    ).toHaveLength(2);
    expect((await loadShowcase(ctx, { photo: true })).total).toBe(0);
  });

  it("banco vazio tem indicadores zerados e contexto sem permissão é recusado", async () => {
    const ctx = await makeCtx(await makeTenant(), "VIEWER");
    const empty = await loadShowcase(ctx);
    expect(empty.total).toBe(0);
    expect(empty.stats.total).toBe(0);
    expect(empty.products).toEqual([]);
    await expect(
      loadShowcase({ ...ctx, permissions: new Set() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
