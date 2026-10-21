import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { formatDateTime } from "@/lib/format";
import { dashboard, listRuns, reviewQueue, runErrors } from "@/modules/research/service";
import { can, requirePageContext } from "@/server/tenant-context";
import { ApproveOfficialImages, AutoRefresh, NewRunForm, RunControls } from "./research-client";

export const metadata: Metadata = { title: "Pesquisa" };

const RUN_STATUS: Record<string, string> = { RUNNING: "Em execução", PAUSED: "Pausada", CANCELED: "Cancelada", COMPLETED: "Concluída" };
const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export default async function ResearchPage({ params }: PageProps<"/[tenantSlug]/pesquisa">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "research:review")) return <NoPermission />;
  const [d, runs, queue] = await Promise.all([dashboard(ctx), listRuns(ctx), reviewQueue(ctx)]);
  const active = runs.some((r) => r.status === "RUNNING");
  const errors = await Promise.all(runs.slice(0, 3).map((r) => runErrors(ctx, r.id)));
  const base = `/${ctx.tenantSlug}/produtos`;
  const kpi = (label: string, value: number | string, href?: string, tone = "") => (
    <div className={`card p-3 ${tone}`}>
      <p className="text-xs text-slate-500">{label}</p>
      {href ? <Link href={href} className="text-2xl font-semibold hover:underline">{value}</Link> : <p className="text-2xl font-semibold">{value}</p>}
    </div>
  );
  return (
    <div className="space-y-6">
      {active && <AutoRefresh seconds={5} />}
      <h1 className="text-xl font-semibold">Pesquisa e enriquecimento</h1>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        {kpi("Total de produtos", d.total.toLocaleString("pt-BR"), base)}
        {kpi("Com custo do distribuidor", d.withCost.toLocaleString("pt-BR"))}
        {kpi("Enriquecidos", d.enriched, `${base}?pesquisa=ENRICHED`)}
        {kpi("Aguardando aprovação", d.awaitingReview, `${base}?pesquisa=NEEDS_REVIEW`, d.awaitingReview ? "border-amber-300" : "")}
        {kpi("Não pesquisados / na fila", d.pending.toLocaleString("pt-BR"), `${base}?pesquisa=PENDING`)}
        {kpi("Erros", d.failed, `${base}?pesquisa=FAILED`, d.failed ? "border-red-300" : "")}
        {kpi("Imagens aprovadas", d.imagesApproved)}
        {kpi("Imagens pendentes de revisão", d.imagesCandidate)}
        {kpi("Produtos sem foto", d.productsWithoutImage.toLocaleString("pt-BR"))}
        {kpi("Documentos encontrados", d.documents)}
        {kpi("Preços pesquisados (aceitos)", d.offersAccepted)}
        {kpi("Produtos com preço de mercado", d.productsWithMarketPrice)}
      </section>

      {can(ctx, "products:write") && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Imagens</h2>
          <p className="text-xs text-slate-500">Imagens oficiais do fabricante já baixadas e conferidas (tipo, decodificação, tamanho mínimo e modelo). Imagens de revendedor exigem aprovação individual na página do produto.</p>
          <ApproveOfficialImages tenantSlug={ctx.tenantSlug} pending={d.officialImagesReady} />
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Provedores</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th>Provedor</th><th>Tipo</th><th>Credencial</th><th>Custo estimado por chamada</th></tr></thead>
          <tbody>
            {d.providers.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-1">{p.label}</td>
                <td>{p.paid ? "API paga/limitada" : "Gratuito (site oficial)"}</td>
                <td>{p.configured ? <span className="text-green-700">configurada</span> : <span className="text-red-700">ausente</span>}</td>
                <td>{p.paid ? brl(p.costPerCallCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Credenciais ficam no .env do servidor (veja docs/pesquisa.md). Sem um provedor de busca, só são pesquisados produtos com página oficial já conhecida.</p>
      </section>

      {can(ctx, "research:run") && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Nova execução</h2>
          <NewRunForm tenantSlug={ctx.tenantSlug} providers={d.providers} />
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Execuções</h2>
        {runs.length === 0 ? <p className="text-sm text-slate-500">Nenhuma execução ainda.</p> : (
          <ul className="space-y-3">
            {runs.map((r, i) => (
              <li key={r.id} className="rounded border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{r.name}</strong>
                  <span className="rounded bg-slate-100 px-1.5 text-xs">{RUN_STATUS[r.status]}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(r.createdAt, ctx.timezone)}</span>
                  {can(ctx, "research:run") && <RunControls tenantSlug={ctx.tenantSlug} runId={r.id} status={r.status} failed={r.jobs.FAILED ?? 0} />}
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={r.percent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-slate-800" style={{ width: `${r.percent}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {r.percent}% · {r.totalJobs} produto(s) · concluídos {r.jobs.SUCCEEDED ?? 0} · na fila {r.jobs.QUEUED ?? 0} · rodando {r.jobs.RUNNING ?? 0} · falhas {r.jobs.FAILED ?? 0} · cancelados {r.jobs.CANCELED ?? 0}
                </p>
                <p className="text-xs text-slate-600">
                  Provedores: {(r.providers as string[]).join(", ")} · chamadas pagas {r.apiCalls}/{r.maxApiCalls} · custo estimado {brl(r.costCents)} de {brl(r.maxCostCents)}
                </p>
                {i < 3 && errors[i].length > 0 && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-red-700">Erros ({errors[i].length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {errors[i].map((e) => <li key={e.id}><Link className="underline" href={`${base}/${e.productId}`}>produto</Link>: {e.lastError}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Aguardando aprovação ({queue.total})</h2>
        {queue.items.length === 0 ? <p className="text-sm text-slate-500">Nada pendente.</p> : (
          <ul className="divide-y text-sm">
            {queue.items.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Link href={`${base}/${q.id}`} className="font-medium hover:underline">{q.name}</Link>
                <span className="font-mono text-xs text-slate-500">{q.sku}</span>
                <span className="ml-auto text-xs text-slate-600">{q._count.researchAssets} evidência(s) · {q._count.offers} cotação(ões)</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
