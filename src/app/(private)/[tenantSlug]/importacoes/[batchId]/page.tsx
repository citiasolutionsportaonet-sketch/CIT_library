import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import type { ImportRowStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { formatBRL } from "@/modules/pricing/calc";
import { getBatch } from "@/modules/imports/service";
import { can, requirePageContext } from "@/server/tenant-context";
import { loadOr404 } from "../../produtos/[id]/load";
import { AutoRefresh } from "../../pesquisa/research-client";
import { BATCH_STATUS } from "../labels";
import { BatchActions } from "./batch-actions";

export const metadata: Metadata = { title: "Lote de importação" };
const FILTERS: Record<string, ImportRowStatus | "WARN" | undefined> = { todas: undefined, invalidas: "INVALID", conflitos: "CONFLICT", aplicadas: "APPLIED", avisos: "WARN" };

export default async function BatchPage({ params, searchParams }: PageProps<"/[tenantSlug]/importacoes/[batchId]">) {
  const { tenantSlug, batchId } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "imports:write")) return <NoPermission />;
  const sp = await searchParams;
  const f = typeof sp.filtro === "string" && sp.filtro in FILTERS ? sp.filtro : "todas";
  const page = Number(sp.pagina ?? 1) || 1;
  const sel = FILTERS[f];
  const d = await loadOr404(() => getBatch(ctx, batchId, { status: sel === "WARN" ? undefined : sel, withWarnings: sel === "WARN", page }));
  const c = d.batch.counters as Record<string, number>;
  const href = (filtro: string, pagina = 1) => `?filtro=${filtro}${pagina > 1 ? `&pagina=${pagina}` : ""}`;
  return (
    <div className="space-y-4">
      {(d.batch.status === "CONFIRMED" || d.batch.status === "APPLYING") && <AutoRefresh seconds={3} />}
      <Link href={`/${ctx.tenantSlug}/importacoes`} className="text-sm text-slate-600 hover:underline">← Importações</Link>
      <h1 className="text-xl font-semibold">{d.batch.fileName}</h1>
      <p className="text-sm text-slate-600">
        {d.batch.supplier} · {BATCH_STATUS[d.batch.status]} · enviado {formatDateTime(d.batch.createdAt, ctx.timezone)}
        {d.batch.effectiveAt && ` · vigência do custo ${formatDateTime(d.batch.effectiveAt, ctx.timezone)}`} · SHA-256 {d.batch.sha256.slice(0, 12)}…
      </p>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Linhas", c.total], ["Válidas", c.valid], ["Inválidas", c.invalid], ["Conflitos (código repetido)", c.conflict], ["Novos produtos", c.create], ["Já existentes", c.existing], ["Com custo", c.withCost], ["Sem custo (zero/vazio)", c.withoutCost], ["Com aviso", c.warnings], ["Aplicadas", c.applied ?? 0]].map(([l, v]) => (
          <div key={String(l)} className="card p-3"><p className="text-xs text-slate-500">{l}</p><p className="text-xl font-semibold">{v ?? 0}</p></div>
        ))}
      </section>
      {d.batch.status === "PARSED" && <BatchActions tenantSlug={ctx.tenantSlug} batchId={d.batch.id} />}
      <nav className="flex flex-wrap gap-2 text-sm">
        {Object.keys(FILTERS).map((k) => <Link key={k} href={href(k)} className={`rounded px-2 py-1 ${k === f ? "bg-slate-900 text-white" : "bg-white"}`}>{k}</Link>)}
      </nav>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Linha</th><th>Código</th><th>Nome</th><th className="text-right">Custo</th><th>Situação</th><th>Ação / mensagens</th></tr></thead>
          <tbody>
            {d.rows.map((r) => {
              const n = r.normalized as { sku: string; name: string; cost: string | null };
              const msgs = [...(r.errors as string[]), ...(r.warnings as string[])];
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2">{r.rowNumber}</td>
                  <td className="font-mono">{n.sku}</td>
                  <td className="max-w-md">{n.name}</td>
                  <td className="whitespace-nowrap text-right">{n.cost ? formatBRL(n.cost) : "—"}</td>
                  <td>{r.status}</td>
                  <td className="max-w-md text-slate-600">{r.action}{msgs.length ? ` · ${msgs.join(" · ")}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {d.page > 1 && <Link className="btn-secondary" href={href(f, d.page - 1)}>Anterior</Link>}
        <span>Página {d.page} de {d.pageCount} · {d.total} linha(s)</span>
        {d.page < d.pageCount && <Link className="btn-secondary" href={href(f, d.page + 1)}>Próxima</Link>}
      </div>
    </div>
  );
}
