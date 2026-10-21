import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { apiGetProduct, apiListProducts, apiProductPrices } from "@/modules/api/catalog";
import type { ApiPrincipal } from "@/modules/api/credentials";
import { exportProductsCsv } from "@/modules/catalog/export";
import { currentAcceptedOffers } from "@/modules/pricing/offers";
import { pricingFor } from "@/modules/pricing/service";
import { createProduct } from "@/modules/products/service";
import type { TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { assertTestDb, makeCtx, makeTenant } from "./helpers";

const hour = 3600_000;
beforeAll(() => assertTestDb());

async function product() {
  const ctx = await makeCtx(await makeTenant(), "OWNER");
  const p = await createProduct(ctx, { name: "Produto para mediana", sku: "MED1" });
  return { ctx, id: p.id };
}

function offer(ctx: TenantContext, productId: string, url: string, price: string, extra: Partial<Prisma.MarketOfferUncheckedCreateInput> = {}) {
  return getDb().marketOffer.create({ data: {
    tenantId: ctx.tenantId, productId, url, price,
    provider: "test", sourceName: "Loja de teste", title: "Oferta de teste",
    observedAt: new Date(Date.now() - hour), status: "ACCEPTED", condition: "NEW", origin: "ENGINE",
    ...extra,
  } });
}

describe("mediana de anúncios vigentes", () => {
  it("pesquisas repetidas não aumentam a amostra; tela, API e CSV concordam", async () => {
    const { ctx, id } = await product();
    const now = Date.now();
    await offer(ctx, id, "https://loja.example/a", "80", { observedAt: new Date(now - 4 * hour) });
    await offer(ctx, id, "https://loja.example/a", "90", { observedAt: new Date(now - 3 * hour) });
    await offer(ctx, id, "https://loja.example/a", "100", { observedAt: new Date(now - 2 * hour) });
    // Outro provedor descobriu o mesmo anúncio: continua sendo uma oferta.
    await offer(ctx, id, "https://loja.example/a", "100", { provider: "other", observedAt: new Date(now - hour) });
    await offer(ctx, id, "https://loja.example/b", "200");

    const view = (await pricingFor(ctx, [id])).get(id)!;
    expect(view).toMatchObject({ marketMedian: "150.00", marketCount: 2, marketSufficient: false });
    const p: ApiPrincipal = { tenantId: ctx.tenantId, credentialId: randomUUID(), scopes: new Set(["catalog:read", "prices:read"]), requestId: "test" };
    const expected = { market: { median: "150.00", acceptedOffers: 2, sufficient: false } };
    expect((await apiListProducts(p, new URL("http://test/products"))).data[0].pricing).toMatchObject(expected);
    expect((await apiGetProduct(p, id)).data.pricing).toMatchObject(expected);
    const prices = (await apiProductPrices(p, id)).data;
    expect(prices.pricing).toMatchObject(expected);
    expect(prices.quotes.map((q) => q.price).sort()).toEqual(["100.00", "200.00"]);
    const exported = await exportProductsCsv(ctx, {});
    const [row] = parse(exported.csv, { delimiter: ";", columns: true, bom: true }) as Record<string, string>[];
    expect(row["Mediana online (R$)"]).toBe("150,00");
    expect(row["Ofertas na mediana"]).toBe("2");
    expect(await getDb().marketOffer.count({ where: { tenantId: ctx.tenantId } })).toBe(5); // histórico preservado
  });

  it.each(["REJECTED", "CANDIDATE"] as const)("observação nova %s não ressuscita a antiga aceita", async (status) => {
    const { ctx, id } = await product();
    await offer(ctx, id, "https://loja.example/a", "100", { observedAt: new Date(Date.now() - 2 * hour) });
    await offer(ctx, id, "https://loja.example/a", "110", { status });
    expect(await currentAcceptedOffers(ctx.tenantId, [id], 90)).toEqual([]);
    expect((await pricingFor(ctx, [id])).get(id)).toMatchObject({ marketMedian: null, marketCount: 0, marketSufficient: false });
  });

  it("usa a data observada, com desempate determinístico por criação e ID", async () => {
    const { ctx, id } = await product();
    const observedAt = new Date(Date.now() - hour);
    const createdAt = new Date(Date.now() - 1000);
    await offer(ctx, id, "https://loja.example/a", "20", { id: "00000000-0000-4000-8000-000000000001", observedAt, createdAt });
    const newest = await offer(ctx, id, "https://loja.example/a", "30", { id: "00000000-0000-4000-8000-000000000002", observedAt, createdAt });
    // Importada depois, mas observada antes: não é a vigente.
    await offer(ctx, id, "https://loja.example/a", "999", { observedAt: new Date(observedAt.getTime() - hour), createdAt: new Date() });
    const current = await currentAcceptedOffers(ctx.tenantId, [id], 90);
    expect(current.map((o) => o.id)).toEqual([newest.id]);
    expect(current[0].price.toFixed(2)).toBe("30.00");
  });

  it("exclui ofertas vencidas, futuras e páginas de listagem", async () => {
    const { ctx, id } = await product();
    const at = new Date();
    await offer(ctx, id, "https://loja.example/expired", "1", { observedAt: new Date(at.getTime() - 91 * 24 * hour) });
    await offer(ctx, id, "https://loja.example/future", "2", { observedAt: new Date(at.getTime() + hour) });
    await offer(ctx, id, "https://loja.example/list", "3", { isListingPage: true });
    const valid = await offer(ctx, id, "https://loja.example/current", "100");
    await offer(ctx, id, valid.url, "200", { status: "REJECTED", observedAt: new Date(at.getTime() + hour) });
    expect((await currentAcceptedOffers(ctx.tenantId, [id], 90, at)).map((o) => o.id)).toEqual([valid.id]);
  });

  it("mantém produtos e organizações separados, mesmo com URLs iguais", async () => {
    const a = await product();
    const b = await product();
    await offer(a.ctx, a.id, "https://loja.example/a", "100");
    await offer(b.ctx, b.id, "https://loja.example/a", "999");
    const other = await createProduct(a.ctx, { name: "Outro produto", sku: "MED2" });
    await offer(a.ctx, other.id, "https://loja.example/a", "200");
    const current = await currentAcceptedOffers(a.ctx.tenantId, [a.id, other.id, b.id], 90);
    expect(current.map((o) => o.price.toFixed(2)).sort()).toEqual(["100.00", "200.00"]);
    expect(await currentAcceptedOffers(a.ctx.tenantId, [], 90)).toEqual([]);
  });
});
