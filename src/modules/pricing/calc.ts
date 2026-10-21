// Regras de preço puras (sem banco), cobertas por testes unitários.
// Dinheiro sempre em Decimal; nunca float. Serialização como string.
import { Decimal } from "@/generated/prisma/internal/prismaNamespace";

export { Decimal };
export type Money = InstanceType<typeof Decimal>;

/**
 * Normaliza um valor numérico vindo da planilha (texto do XML do XLSX, que usa
 * ponto decimal). Artefatos de ponto flutuante (ex.: 123.45000000000002) são
 * arredondados para centavos quando a diferença é desprezível (< 1e-6);
 * do contrário o valor é mantido com até 4 casas e sinalizado.
 */
export function parseSheetAmount(raw: unknown): { value: Money | null; error?: string; warning?: string } {
  if (raw === null || raw === undefined) return { value: null };
  const text = String(raw).trim();
  if (text === "") return { value: null };
  if (!/^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(text)) return { value: null, error: `Valor não numérico: "${text.slice(0, 30)}"` };
  const d = new Decimal(text);
  if (d.isNegative()) return { value: null, error: "Valor negativo não é permitido." };
  const cents = d.toDecimalPlaces(2);
  if (d.minus(cents).abs().lessThan("0.000001")) return { value: cents };
  const four = d.toDecimalPlaces(4);
  return { value: four, warning: `Valor com mais de 2 casas decimais (${text}); mantido como ${four.toFixed(4)}.` };
}

/**
 * Converte valor digitado em pt-BR ("1.234,56"). Formatos ambíguos são
 * rejeitados em vez de adivinhados.
 */
export function parseBrlInput(raw: string): Money | null {
  const t = raw.trim().replace(/^R\$\s*/i, "");
  if (t === "") return null;
  if (/^\d{1,3}(\.\d{3})*(,\d{1,4})?$/.test(t) || /^\d+(,\d{1,4})?$/.test(t)) {
    return new Decimal(t.replace(/\./g, "").replace(",", "."));
  }
  throw new Error(`Valor inválido: "${raw}". Use o formato 1.234,56.`);
}

export function median(values: Money[]): Money | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : s[mid - 1].plus(s[mid]).dividedBy(2);
}

export type PricingParams = { markup: Money; webUplift: Money; minOffersForMedian: number };

export type PricingResult = {
  /** Custo no distribuidor (interno; nunca exibido a quem não tem costs:read). */
  cost: Money | null;
  markup: Money;
  /** Metodologia 1: custo × (1 + markup). */
  citPrice: Money | null;
  /** Metodologia 2: mediana de ofertas aceitas e comparáveis. */
  marketMedian: Money | null;
  marketCount: number;
  marketSufficient: boolean;
  /** Referência comercial alternativa = mediana × (1 + uplift). NÃO é preço anunciado. */
  webReference: Money | null;
  /** Preço CIT − mediana online (positivo = CIT acima do mercado). */
  diffAbs: Money | null;
  diffPct: Money | null;
};

export function computePricing(cost: Money | null, acceptedOfferPrices: Money[], p: PricingParams): PricingResult {
  const citPrice = cost && cost.greaterThan(0) ? cost.times(new Decimal(1).plus(p.markup)).toDecimalPlaces(2) : null;
  const med = median(acceptedOfferPrices);
  const marketMedian = med ? med.toDecimalPlaces(2) : null;
  const webReference = marketMedian ? marketMedian.times(new Decimal(1).plus(p.webUplift)).toDecimalPlaces(2) : null;
  const diffAbs = citPrice && marketMedian ? citPrice.minus(marketMedian) : null;
  const diffPct = diffAbs && marketMedian && !marketMedian.isZero() ? diffAbs.dividedBy(marketMedian).times(100).toDecimalPlaces(1) : null;
  return {
    cost,
    markup: p.markup,
    citPrice,
    marketMedian,
    marketCount: acceptedOfferPrices.length,
    marketSufficient: acceptedOfferPrices.length >= p.minOffersForMedian,
    webReference,
    diffAbs,
    diffPct,
  };
}

export function formatBRL(v: Money | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const d = typeof v === "string" ? new Decimal(v) : v;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(d.toFixed(2)));
}

export function formatPct(v: Money | string | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  const d = typeof v === "string" ? new Decimal(v) : v;
  return `${d.toFixed(digits).replace(".", ",")}%`;
}
