import "server-only";
import { buildProductWhere, type ListParams, withSubcategories } from "@/modules/products/service";
import { pricingFor } from "@/modules/pricing/service";
import { audit } from "@/server/audit";
import { assertCan, can, type TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { writeTx } from "@/server/maintenance";

export const EXPORT_MAX = 20_000;

/**
 * Neutraliza injeção de fórmula (=, +, -, @, tab, CR) prefixando apóstrofo,
 * conforme OWASP; aspas duplicadas; separador ";" (Excel pt-BR).
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const money = (v: string | null | undefined) => (v ? v.replace(".", ",") : "");

export async function exportProductsCsv(ctx: TenantContext, filter: ListParams): Promise<{ csv: string; rows: number; withCost: boolean }> {
  assertCan(ctx, "catalog:read");
  const where = buildProductWhere(ctx, await withSubcategories(ctx, filter));
  const products = await getDb().product.findMany({
    where,
    orderBy: [{ normalizedSku: "asc" }, { id: "asc" }],
    take: EXPORT_MAX + 1,
    include: { brand: { select: { name: true } }, category: { select: { name: true } } },
  });
  if (products.length > EXPORT_MAX) throw new DomainError("CONFLICT", `Mais de ${EXPORT_MAX} produtos: refine o filtro.`);
  const withCost = can(ctx, "costs:read");
  const prices = new Map<string, Awaited<ReturnType<typeof pricingFor>> extends Map<string, infer V> ? V : never>();
  for (let i = 0; i < products.length; i += 1000) {
    for (const [k, v] of await pricingFor(ctx, products.slice(i, i + 1000).map((p) => p.id))) prices.set(k, v);
  }
  const header = ["SKU", "Nome", "Marca", "Modelo", "Modelo sugerido", "Categoria", "Status", "Unidade", "EAN/GTIN", "Código do fabricante", ...(withCost ? ["Custo distribuidor (R$)"] : []), "Markup (%)", "Preço CIT (R$)", "Mediana online (R$)", "Ofertas na mediana", "Referência comercial mediana+15% (R$)", "Diferença CIT x mediana (R$)", "Situação da pesquisa"];
  const lines = [header.map(csvCell).join(";")];
  for (const p of products) {
    const pr = prices.get(p.id)!;
    lines.push(
      [
        p.sku, p.name, p.brand?.name, p.model, p.suggestedModel, p.category?.name, p.status, p.unit, p.gtin, p.manufacturerCode,
        ...(withCost ? [money(pr.cost)] : []),
        pr.markupPct.replace(".", ","), money(pr.citPrice), money(pr.marketMedian), pr.marketCount, money(pr.webReference), money(pr.diffAbs), p.researchStatus,
      ].map(csvCell).join(";"),
    );
  }
  await writeTx((tx) =>
    audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: withCost ? "export.products.with_cost" : "export.products", entityType: "Tenant", entityId: ctx.tenantId, diff: { rows: products.length, filter, withCost } }),
  );
  // BOM para o Excel reconhecer UTF-8.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, rows: products.length, withCost };
}
