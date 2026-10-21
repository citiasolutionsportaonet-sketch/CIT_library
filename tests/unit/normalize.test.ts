import { describe, expect, it } from "vitest";
import { isValidGtin } from "@/lib/gtin";
import { cleanText, normalizeCode, normalizeEmail, normalizeName, slugify } from "@/lib/normalize";

describe("normalização", () => {
  it("preserva zeros à esquerda e não converte códigos para número", () => {
    expect(normalizeCode("  00123-ab ")).toBe("00123-AB");
    expect(normalizeCode("0001")).toBe("0001");
  });
  it("colapsa espaços e normaliza Unicode compatível em códigos", () => {
    expect(normalizeCode("ＡＢＣ   12")).toBe("ABC 12");
  });
  it("nomes deduplicam sem acento e caixa", () => {
    expect(normalizeName("  Câmeras   IP ")).toBe("cameras ip");
    expect(normalizeName("INTELBRAS")).toBe(normalizeName("Intelbras"));
  });
  it("texto: NFC e trim", () => {
    expect(cleanText("  á  b ")).toBe("á b");
  });
  it("e-mail minúsculo", () => expect(normalizeEmail(" Ana@Ex.COM ")).toBe("ana@ex.com"));
  it("slug", () => expect(slugify("CIT Soluções")).toBe("cit-solucoes"));
});

describe("GTIN", () => {
  it.each(["7891234567895", "96385074", "036000291452", "10012345678902"])("aceita %s", (g) => expect(isValidGtin(g)).toBe(true));
  it.each(["7891234567894", "1234567", "abc", "789123456789", ""])("recusa %s", (g) => expect(isValidGtin(g)).toBe(false));
});
