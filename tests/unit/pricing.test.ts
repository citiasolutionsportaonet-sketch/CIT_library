import { describe, expect, it } from "vitest";
import { computePricing, Decimal, median, parseBrlInput, parseSheetAmount } from "@/modules/pricing/calc";

const D = (v: string | number) => new Decimal(v);
const P = { markup: D("0.45"), webUplift: D("0.15"), minOffersForMedian: 3 };

describe("valores da planilha", () => {
  it("normaliza artefato de ponto flutuante para centavos", () => {
    expect(parseSheetAmount("240.00400000000002").value?.toFixed(4)).toBe("240.0040");
    expect(parseSheetAmount("123.45000000000002").value?.toString()).toBe("123.45");
    expect(parseSheetAmount("121.09").value?.toString()).toBe("121.09");
  });
  it("sinaliza mais de 2 casas reais", () => {
    const r = parseSheetAmount("10.1234");
    expect(r.value?.toString()).toBe("10.1234");
    expect(r.warning).toBeTruthy();
  });
  it("vazio é nulo; negativo e texto são erro", () => {
    expect(parseSheetAmount("").value).toBeNull();
    expect(parseSheetAmount(null).value).toBeNull();
    expect(parseSheetAmount("-1").error).toBeTruthy();
    expect(parseSheetAmount("abc").error).toBeTruthy();
  });
  it("zero continua zero (decisão de ausência fica na importação)", () => {
    expect(parseSheetAmount("0").value?.isZero()).toBe(true);
  });
});

describe("entrada pt-BR", () => {
  it("aceita formatos brasileiros", () => {
    expect(parseBrlInput("1.234,56")?.toString()).toBe("1234.56");
    expect(parseBrlInput("R$ 99,9")?.toString()).toBe("99.9");
    expect(parseBrlInput("1500")?.toString()).toBe("1500");
  });
  it("recusa ambíguos", () => {
    expect(() => parseBrlInput("1,234.56")).toThrow();
    expect(() => parseBrlInput("12.34")).toThrow();
  });
});

describe("precificação", () => {
  it("mediana ímpar e par", () => {
    expect(median([D(3), D(1), D(2)])?.toString()).toBe("2");
    expect(median([D(4), D(1), D(2), D(3)])?.toString()).toBe("2.5");
    expect(median([])).toBeNull();
  });
  it("planilha piloto: VIP 1230 B G5 (custo 278,50; ofertas 449; 476,74; 492)", () => {
    const r = computePricing(D("278.5"), [D("449"), D("476.74"), D("492")], P);
    expect(r.citPrice?.toFixed(2)).toBe("403.83"); // 278,50 × 1,45 = 403,825
    expect(r.marketMedian?.toFixed(2)).toBe("476.74");
    expect(r.webReference?.toFixed(2)).toBe("548.25");
    expect(r.diffAbs?.toFixed(2)).toBe("-72.91");
    expect(r.marketSufficient).toBe(true);
  });
  it("sem custo não gera preço CIT; sem ofertas não gera mediana", () => {
    const r = computePricing(null, [], P);
    expect(r.citPrice).toBeNull();
    expect(r.marketMedian).toBeNull();
    expect(r.webReference).toBeNull();
    expect(r.diffAbs).toBeNull();
  });
  it("menos ofertas que o mínimo: mediana calculada, mas insuficiente", () => {
    const r = computePricing(D(100), [D(150), D(170)], P);
    expect(r.marketMedian?.toFixed(2)).toBe("160.00");
    expect(r.marketSufficient).toBe(false);
  });
  it("markup 0% = custo", () => {
    expect(computePricing(D("10.50"), [], { ...P, markup: D(0) }).citPrice?.toFixed(2)).toBe("10.50");
  });
});

import { splitLongName } from "@/modules/imports/service";
describe("descrição longa na importação", () => {
  it("até 200 mantém; acima resume em palavra e guarda completo", () => {
    expect(splitLongName("Curto")).toEqual({ name: "Curto", description: null });
    const long = `${"PALAVRA ".repeat(40)}FIM`.trim();
    const r = splitLongName(long);
    expect(r.name.length).toBeLessThanOrEqual(200);
    expect(r.name.endsWith("…")).toBe(true);
    expect(r.name).not.toMatch(/PALAV…$/);
    expect(r.description).toBe(long);
  });
});
