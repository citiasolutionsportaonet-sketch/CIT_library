import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { createProduct, duplicateProduct, getProduct, listProducts, setArchived, updateProduct } from "@/modules/products/service";
import { assertTestDb, makeCtx, makeTenant } from "./helpers";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof DomainError ? e.code : String(e)));

describe("produtos (PostgreSQL real)", () => {
  beforeAll(() => assertTestDb());

  it("cria rascunho mínimo, persiste e preserva zeros à esquerda", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    const { id } = await createProduct(ctx, { name: "Câmera X", sku: "000123" });
    const p = await getProduct(ctx, id);
    expect(p.sku).toBe("000123");
    expect(p.status).toBe("DRAFT");
    expect(p.version).toBe(1);
  });

  it("SKU duplicado (normalizado) retorna CONFLICT com campo", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    await createProduct(ctx, { name: "A", sku: "abc-1" });
    const err = await createProduct(ctx, { name: "B", sku: " ABC-1 " }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("CONFLICT");
    expect(err.fields.sku).toBeTruthy();
  });

  it("SKU concorrente: só um vence", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    const r = await Promise.allSettled([1, 2, 3, 4].map((i) => createProduct(ctx, { name: `P${i}`, sku: "RACE" })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("mesmo SKU em tenants diferentes é permitido", async () => {
    const a = await makeCtx(await makeTenant(), "OWNER");
    const b = await makeCtx(await makeTenant(), "OWNER");
    await createProduct(a, { name: "A", sku: "S1" });
    await expect(createProduct(b, { name: "B", sku: "S1" })).resolves.toBeTruthy();
  });

  it("versão otimista: edição com versão antiga é rejeitada", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    const { id } = await createProduct(ctx, { name: "V", sku: "V1" });
    await updateProduct(ctx, id, 1, { name: "V2", sku: "V1" });
    expect(await code(updateProduct(ctx, id, 1, { name: "V3", sku: "V1" }))).toBe("VERSION_CONFLICT");
    expect((await getProduct(ctx, id)).name).toBe("V2");
  });

  it("código do fabricante único por marca", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    await createProduct(ctx, { name: "A", sku: "1", brand: "Intelbras", manufacturerCode: "4560001" });
    expect(await code(createProduct(ctx, { name: "B", sku: "2", brand: "INTELBRAS", manufacturerCode: "4560001" }))).toBe("CONFLICT");
    await expect(createProduct(ctx, { name: "C", sku: "3", brand: "Outra", manufacturerCode: "4560001" })).resolves.toBeTruthy();
  });

  it("arquivado sai da busca padrão e volta ao restaurar", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    const { id } = await createProduct(ctx, { name: "Arq", sku: "AR" });
    await setArchived(ctx, id, 1, true);
    expect((await listProducts(ctx, {})).total).toBe(0);
    expect((await listProducts(ctx, { status: "ARCHIVED" })).total).toBe(1);
    expect(await code(updateProduct(ctx, id, 2, { name: "x", sku: "AR" }))).toBe("CONFLICT");
    await setArchived(ctx, id, 2, false);
    expect((await listProducts(ctx, { q: "arq" })).total).toBe(1);
  });

  it("busca por SKU, modelo e código; duplicar exige novo SKU", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    const { id } = await createProduct(ctx, { name: "Roteador", sku: "R-01", brand: "Intelbras", model: "W5-1200", manufacturerCode: "0042", tags: ["wifi"] });
    expect((await listProducts(ctx, { q: "w5-12" })).total).toBe(1);
    expect((await listProducts(ctx, { q: "0042" })).total).toBe(1);
    expect((await listProducts(ctx, { q: "r-01" })).total).toBe(1);
    expect(await code(duplicateProduct(ctx, id, "r-01"))).toBe("CONFLICT");
    const dup = await duplicateProduct(ctx, id, "R-02");
    const d = await getProduct(ctx, dup.id);
    expect(d.status).toBe("DRAFT");
    expect(d.manufacturerCode).toBeNull();
    expect(d.tags.map((t) => t.name)).toEqual(["wifi"]);
  });

  it("VIEWER não escreve e não recebe notas internas", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const viewer = await makeCtx(t, "VIEWER");
    const { id } = await createProduct(owner, { name: "N", sku: "N1", internalNotes: "margem secreta" });
    expect(await code(createProduct(viewer, { name: "x", sku: "x" }))).toBe("FORBIDDEN");
    expect(await code(updateProduct(viewer, id, 1, { name: "x", sku: "N1" }))).toBe("FORBIDDEN");
    expect(await code(setArchived(viewer, id, 1, true))).toBe("FORBIDDEN");
    expect((await getProduct(viewer, id)).internalNotes).toBeNull();
    expect((await getProduct(owner, id)).internalNotes).toBe("margem secreta");
  });

  it("isolamento: tenant A não lê nem altera produto de B", async () => {
    const a = await makeCtx(await makeTenant(), "OWNER");
    const b = await makeCtx(await makeTenant(), "OWNER");
    const { id } = await createProduct(b, { name: "Segredo B", sku: "B1" });
    expect(await code(getProduct(a, id))).toBe("NOT_FOUND");
    expect(await code(updateProduct(a, id, 1, { name: "x", sku: "B1" }))).toBe("NOT_FOUND");
    expect(await code(setArchived(a, id, 1, true))).toBe("NOT_FOUND");
    expect(await code(duplicateProduct(a, id, "X"))).toBe("NOT_FOUND");
    expect((await listProducts(a, { q: "Segredo" })).total).toBe(0);
  });

  it("FK composta impede relacionar marca de outro tenant, mesmo direto no banco", async () => {
    const a = await makeCtx(await makeTenant(), "OWNER");
    const b = await makeCtx(await makeTenant(), "OWNER");
    const brandB = await getDb().brand.create({ data: { tenantId: b.tenantId, name: "MB", normalizedName: "mb" } });
    await expect(
      getDb().product.create({ data: { tenantId: a.tenantId, sku: "X", normalizedSku: "X", name: "X", brandId: brandB.id, createdById: a.userId, updatedById: a.userId } }),
    ).rejects.toThrow();
  });

  it("auditoria é append-only para o papel do aplicativo", async () => {
    const ctx = await makeCtx(await makeTenant(), "OWNER");
    await createProduct(ctx, { name: "Aud", sku: "AUD" });
    const ev = await getDb().auditEvent.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
    await expect(getDb().auditEvent.update({ where: { id: ev.id }, data: { action: "x" } })).rejects.toThrow();
    await expect(getDb().auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
  });
});
