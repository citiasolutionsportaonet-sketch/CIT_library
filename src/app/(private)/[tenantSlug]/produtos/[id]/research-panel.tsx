"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { approveAssetAction, rejectAssetAction, reviewOfferAction } from "./research-actions";

type Asset = { id: string; kind: string; url: string; sourceName: string; sourceType: string; title: string | null; status: string; width: number | null; height: number | null; byteSize: number | null; reviewNote: string | null; origin: string; data: Record<string, unknown> };
type Offer = { id: string; provider: string; sourceName: string; url: string; title: string; price: string; condition: string; observedAt: string; status: string; isListingPage: boolean; matchScore: number; matchReasons: string[]; reviewNote: string | null; origin: string };

const STATUS: Record<string, string> = { CANDIDATE: "Aguardando", ACCEPTED: "Aprovado", REJECTED: "Rejeitado" };
const KIND: Record<string, string> = { IMAGE: "Imagem", DATASHEET: "Ficha técnica", MANUAL: "Manual", OFFICIAL_PAGE: "Página oficial", SPEC: "Dados estruturados" };
const brl = (v: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));

export function ResearchPanel({ tenantSlug, productId, assets, offers, canReview }: { tenantSlug: string; productId: string; assets: Asset[]; offers: Offer[]; canReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(id: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.message ?? "Falha.");
    router.refresh();
  }
  const badge = (s: string) => <span className={`rounded px-1.5 py-0.5 text-[11px] ${s === "ACCEPTED" ? "bg-green-100 text-green-800" : s === "REJECTED" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-800"}`}>{STATUS[s] ?? s}</span>;
  const images = assets.filter((a) => a.kind === "IMAGE");
  const docs = assets.filter((a) => a.kind !== "IMAGE");

  return (
    <section className="card space-y-5 p-4">
      <div>
        <h2 className="font-semibold">Pesquisa e evidências</h2>
        <p className="text-xs text-slate-500">Nada entra no catálogo sem aprovação. Ofertas de páginas de busca/loja nunca entram na mediana.</p>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Imagens ({images.length})</h3>
        {images.length === 0 ? <p className="text-sm text-slate-500">Nenhuma imagem encontrada.</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((a) => (
              <li key={a.id} className="rounded border border-slate-200 p-2 text-xs">
                <div className="mb-1 flex aspect-square items-center justify-center bg-slate-50">
                  {a.status !== "REJECTED" && canReview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/research/assets/${a.id}/preview`} alt={`Candidata de ${a.sourceName}`} className="max-h-full max-w-full object-contain" loading="lazy" />
                  ) : <span className="text-slate-400">sem prévia</span>}
                </div>
                <div className="flex items-center gap-1">{badge(a.status)} <span className="truncate">{a.sourceName}</span></div>
                <p className="text-slate-500">{a.sourceType === "OFFICIAL" ? "Fonte oficial" : "Revendedor/terceiro"}{a.width ? ` · ${a.width}×${a.height}` : ""}</p>
                {a.reviewNote && <p className="text-slate-500">{a.reviewNote}</p>}
                <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-700 underline">origem</a>
                {canReview && a.status === "CANDIDATE" && (
                  <div className="mt-1 flex gap-1">
                    <button className="btn-secondary px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => act(a.id, () => approveAssetAction(tenantSlug, productId, a.id))}>{busy === a.id ? "…" : "Aprovar"}</button>
                    <button className="btn-danger px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => act(a.id, () => rejectAssetAction(tenantSlug, productId, a.id))}>Rejeitar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Documentos, páginas e dados ({docs.length})</h3>
        {docs.length === 0 ? <p className="text-sm text-slate-500">Nenhum documento encontrado.</p> : (
          <ul className="space-y-1 text-sm">
            {docs.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                {badge(a.status)} <span className="font-medium">{KIND[a.kind] ?? a.kind}</span>
                {a.kind === "SPEC" ? <code className="text-xs">{JSON.stringify(a.data)}</code> : (
                  <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-blue-700 underline">{a.title || a.url}</a>
                )}
                <span className="text-xs text-slate-500">{a.sourceName}{a.origin === "IMPORT_PRELIMINARY" ? " · planilha preliminar" : ""}</span>
                {a.reviewNote && <span className="text-xs text-slate-500">— {a.reviewNote}</span>}
                {canReview && a.status === "CANDIDATE" && (
                  <>
                    <button className="btn-secondary px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => act(a.id, () => approveAssetAction(tenantSlug, productId, a.id))}>Aprovar</button>
                    <button className="btn-danger px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => act(a.id, () => rejectAssetAction(tenantSlug, productId, a.id))}>Rejeitar</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Cotações observadas ({offers.length})</h3>
        {offers.length === 0 ? <p className="text-sm text-slate-500">Nenhuma cotação registrada.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500"><tr><th className="py-1">Situação</th><th>Fonte</th><th>Preço</th><th>Data</th><th>Correspondência</th><th></th></tr></thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-t align-top">
                    <td className="py-1">{badge(o.status)}{o.isListingPage && <div className="mt-1 text-[11px] text-red-700">página de busca</div>}</td>
                    <td><a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-700 underline">{o.sourceName}</a><div className="max-w-xs text-slate-500">{o.title}</div></td>
                    <td className="whitespace-nowrap">{brl(o.price)}</td>
                    <td className="whitespace-nowrap">{new Date(o.observedAt).toLocaleDateString("pt-BR")}</td>
                    <td className="max-w-xs text-slate-500">{o.matchScore ? `${o.matchScore}/100 · ` : ""}{o.matchReasons.join("; ")}{o.reviewNote ? ` · ${o.reviewNote}` : ""}</td>
                    <td className="whitespace-nowrap">
                      {canReview && o.status !== "ACCEPTED" && !o.isListingPage && <button className="btn-secondary px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => act(o.id, () => reviewOfferAction(tenantSlug, productId, o.id, "ACCEPTED"))}>Aceitar</button>}
                      {canReview && o.status !== "REJECTED" && <button className="btn-danger ml-1 px-2 py-0.5 text-xs" disabled={!!busy} onClick={() => act(o.id, () => reviewOfferAction(tenantSlug, productId, o.id, "REJECTED"))}>Rejeitar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
