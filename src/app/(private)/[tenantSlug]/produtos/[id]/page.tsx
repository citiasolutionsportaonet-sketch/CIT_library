import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime, STATUS_LABEL } from "@/lib/format";
import { formatBRL } from "@/modules/pricing/calc";
import { costHistory, pricingFor } from "@/modules/pricing/service";
import { productResearch } from "@/modules/research/service";
import { getProduct, productPendencies } from "@/modules/products/service";
import { can, requirePageContext } from "@/server/tenant-context";
import { Gallery } from "./gallery";
import { loadOr404 } from "./load";
import { PricingSection } from "./pricing-section";
import { ProductActions } from "./product-actions";
import { ResearchPanel } from "./research-panel";
import { Suggestions } from "./suggestions";

export const metadata: Metadata = { title: "Produto" };

export default async function ProductPage({ params }: PageProps<"/[tenantSlug]/produtos/[id]">) {
  const { tenantSlug, id } = await params;
  const ctx = await requirePageContext(tenantSlug);
  const p = await loadOr404(() => getProduct(ctx, id));
  const [pricing, research, history] = await Promise.all([
    pricingFor(ctx, [p.id]).then((m) => m.get(p.id)!),
    productResearch(ctx, p.id),
    can(ctx, "costs:read") ? costHistory(ctx, p.id) : Promise.resolve([]),
  ]);
  const writable = can(ctx, "products:write");
  const pend = productPendencies(p);
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[10rem_1fr] gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words">{value ?? "—"}</dd>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <Link href={`/${ctx.tenantSlug}/produtos`} className="text-sm text-slate-600 hover:underline">← Produtos</Link>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="text-sm text-slate-600">
            {[p.brand?.name, p.model].filter(Boolean).join(" · ") || "Sem marca/modelo"} · <span className="font-mono">{p.sku}</span> ·{" "}
            <strong>{STATUS_LABEL[p.status]}</strong>
          </p>
        </div>
        {writable && <ProductActions tenantSlug={ctx.tenantSlug} id={p.id} version={p.version} status={p.status} />}
      </div>

      {p.status === "ARCHIVED" && (
        <p className="rounded-md bg-slate-100 p-3 text-sm">Produto arquivado em {formatDateTime(p.archivedAt!, ctx.timezone)}. Ele não aparece na busca padrão.</p>
      )}
      {writable && p.status !== "ARCHIVED" && ((p.suggestedModel && !p.model) || (p.suggestedManufacturer && !p.brand)) && (
        <Suggestions tenantSlug={ctx.tenantSlug} productId={p.id} model={!p.model ? p.suggestedModel : null} manufacturer={!p.brand ? p.suggestedManufacturer : null} />
      )}
      {writable && pend.length > 0 && p.status !== "ARCHIVED" && (
        <ul className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          {pend.map((x) => <li key={x}>• {x}</li>)}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Gallery photos={p.media.map((m) => ({ id: m.id, alt: m.altText || p.name }))} coverId={p.coverMediaId} />
        <div className="space-y-6">
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Dados</h2>
            <dl>
              {row("SKU", <span className="font-mono">{p.sku}</span>)}
              {row("Marca", p.brand?.name)}
              {row("Modelo", p.model)}
              {row("Código do fabricante", p.manufacturerCode && <span className="font-mono">{p.manufacturerCode}</span>)}
              {row("EAN/GTIN", p.gtin && <span className="font-mono">{p.gtin}</span>)}
              {row("Categoria", p.category?.name)}
              {row("Unidade", p.unit)}
              {row("Tags", p.tags.length ? p.tags.map((t) => t.name).join(", ") : null)}
            </dl>
          </section>
          {p.specs.length > 0 && (
            <section className="card p-4">
              <h2 className="mb-2 font-semibold">Características técnicas</h2>
              <dl>{p.specs.map((s, i) => <div key={i}>{row(s.key, `${s.value}${s.unit ? ` ${s.unit}` : ""}`)}</div>)}</dl>
            </section>
          )}
          {p.links.length > 0 && (
            <section className="card p-4">
              <h2 className="mb-2 font-semibold">Links oficiais</h2>
              <ul className="space-y-1 text-sm">
                {p.links.map((l, i) => (
                  <li key={i}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-blue-700 underline">
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {p.description && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Descrição</h2>
          <p className="whitespace-pre-wrap text-sm">{p.description}</p>
        </section>
      )}
      {p.internalNotes && (
        <section className="card border-amber-200 p-4">
          <h2 className="mb-2 font-semibold">Observações internas</h2>
          <p className="whitespace-pre-wrap text-sm">{p.internalNotes}</p>
        </section>
      )}
      <PricingSection pricing={pricing} canSeeCost={can(ctx, "costs:read")} />
      {can(ctx, "costs:read") && history.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Histórico de custo ({history.length})</summary>
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-slate-500"><tr><th>Vigência</th><th>Valor</th><th>Origem</th><th>Registrado em</th><th>Motivo</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="py-1">{formatDateTime(h.effectiveAt, ctx.timezone)}</td>
                  <td>{formatBRL(h.amount)}</td>
                  <td>{h.source === "IMPORT" ? "Importação" : "Manual"}</td>
                  <td>{formatDateTime(h.recordedAt, ctx.timezone)}</td>
                  <td>{h.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <ResearchPanel
        tenantSlug={ctx.tenantSlug}
        productId={p.id}
        canReview={can(ctx, "research:review")}
        assets={research.assets.map((a) => ({ id: a.id, kind: a.kind, url: a.url, sourceName: a.sourceName, sourceType: a.sourceType, title: a.title, status: a.status, width: a.width, height: a.height, byteSize: a.byteSize, reviewNote: a.reviewNote, origin: a.origin, data: a.data }))}
        offers={research.offers.map((o) => ({ id: o.id, provider: o.provider, sourceName: o.sourceName, url: o.url, title: o.title, price: o.price, condition: o.condition, observedAt: o.observedAt.toISOString(), status: o.status, isListingPage: o.isListingPage, matchScore: o.matchScore, matchReasons: o.matchReasons, reviewNote: o.reviewNote, origin: o.origin }))}
      />
      <p className="text-xs text-slate-500">
        Criado por {p.createdBy} em {formatDateTime(p.createdAt, ctx.timezone)} · Atualizado por {p.updatedBy} em {formatDateTime(p.updatedAt, ctx.timezone)} · Versão {p.version}
      </p>
    </div>
  );
}
