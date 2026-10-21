import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { formatDateTime } from "@/lib/format";
import { listBatches } from "@/modules/imports/service";
import { can, requirePageContext } from "@/server/tenant-context";
import { BATCH_STATUS } from "./labels";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Importações" };

export default async function ImportsPage({ params }: PageProps<"/[tenantSlug]/importacoes">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "imports:write")) return <NoPermission />;
  const batches = await listBatches(ctx);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Importações</h1>
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Enviar planilha do distribuidor</h2>
        <p className="text-sm text-slate-600">XLSX até 20 MB e 20 mil linhas, com colunas Código Produto, Descrição do Produto e PREÇO (custo). O envio gera uma prévia; nada muda no catálogo até você confirmar.</p>
        <UploadForm tenantSlug={ctx.tenantSlug} />
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Lotes</h2>
        {batches.length === 0 ? <p className="text-sm text-slate-500">Nenhum lote.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th>Arquivo</th><th>Fornecedor</th><th>Situação</th><th>Linhas</th><th>Enviado</th></tr></thead>
            <tbody>
              {batches.map((b) => {
                const c = b.counters as Record<string, number>;
                return (
                  <tr key={b.id} className="border-t">
                    <td className="py-1.5"><Link className="font-medium hover:underline" href={`/${ctx.tenantSlug}/importacoes/${b.id}`}>{b.fileName}</Link></td>
                    <td>{b.supplier}</td>
                    <td>{BATCH_STATUS[b.status]}</td>
                    <td>{c.total} ({c.valid} válidas{c.applied ? `, ${c.applied} aplicadas` : ""})</td>
                    <td>{formatDateTime(b.createdAt, ctx.timezone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
