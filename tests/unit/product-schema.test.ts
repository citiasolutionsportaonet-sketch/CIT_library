import { describe, expect, it } from "vitest";
import { productInputSchema, zodFieldErrors } from "@/modules/products/schema";

const parse = (v: unknown) => productInputSchema.safeParse(v);

describe("schema de produto", () => {
  it("rascunho com apenas nome e SKU", () => {
    const r = parse({ name: " Câmera ", sku: " 0001 " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Câmera");
      expect(r.data.sku).toBe("0001");
      expect(r.data.status).toBe("DRAFT");
      expect(r.data.unit).toBe("UN");
      expect(r.data.brand).toBeNull();
    }
  });
  it("exige nome e SKU", () => {
    const r = parse({ name: "", sku: "  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(zodFieldErrors(r.error)).sort()).toEqual(["name", "sku"]);
  });
  it("ativar exige marca e modelo", () => {
    const r = parse({ name: "X", sku: "1", status: "ACTIVE" });
    expect(r.success).toBe(false);
    if (!r.success) expect(zodFieldErrors(r.error)).toMatchObject({ brand: expect.any(String), model: expect.any(String) });
  });
  it("código do fabricante exige marca", () => {
    const r = parse({ name: "X", sku: "1", manufacturerCode: "ABC" });
    expect(r.success).toBe(false);
  });
  it("GTIN inválido é recusado e vazio vira null", () => {
    expect(parse({ name: "X", sku: "1", gtin: "7891234567894" }).success).toBe(false);
    const ok = parse({ name: "X", sku: "1", gtin: "" });
    expect(ok.success && ok.data.gtin).toBeNull();
  });
  it("links somente http/https", () => {
    expect(parse({ name: "X", sku: "1", links: [{ url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(parse({ name: "X", sku: "1", links: [{ url: "https://www.intelbras.com" }] }).success).toBe(true);
  });
  it("limites de tamanho", () => {
    expect(parse({ name: "a".repeat(201), sku: "1" }).success).toBe(false);
    expect(parse({ name: "a", sku: "1".repeat(81) }).success).toBe(false);
    expect(parse({ name: "a", sku: "1", tags: Array.from({ length: 31 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(parse({ name: "a", sku: "1", specs: Array.from({ length: 101 }, () => ({ key: "k", value: "v" })) }).success).toBe(false);
  });
  it("ignora campos fora da allowlist (mass assignment)", () => {
    const r = parse({ name: "X", sku: "1", tenantId: "outro", createdById: "x", version: 99 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("tenantId");
  });
  it("payload XSS é tratado como texto simples", () => {
    const r = parse({ name: "<script>alert(1)</script>", sku: "1" });
    expect(r.success && r.data.name).toBe("<script>alert(1)</script>");
  });
});
