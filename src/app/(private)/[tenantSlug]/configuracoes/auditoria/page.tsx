import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { formatDateTime } from "@/lib/format";
import { listAudit } from "@/modules/tenants/service";
import { can, requirePageContext } from "@/server/tenant-context";

export const metadata: Metadata = { title: "Auditoria" };

export default async function AuditPage({ params, searchParams }: PageProps<"/[tenantSlug]/configuracoes/auditoria">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "audit:read")) return <NoPermission />;
  const page = Math.max(1, Number((await searchParams).pagina ?? 1) || 1);
  const rows = await listAudit(ctx, page);
  return (
    <div className="space-y-4">
      <Link href={`/${ctx.tenantSlug}/configuracoes`} className="text-sm text-slate-600 hover:underline">← Configurações</Link>
      <h1 className="text-xl font-semibold">Auditoria</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 uppercase text-slate-500">
            <tr><th className="p-2">Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-2 whitespace-nowrap">{formatDateTime(r.createdAt, ctx.timezone)}</td>
                <td className="p-2">{r.actorName}</td>
                <td className="p-2 font-mono">{r.action}</td>
                <td className="p-2 font-mono">{r.entityType}:{r.entityId.slice(0, 8)}</td>
                <td className="p-2"><code className="block max-w-xl whitespace-pre-wrap break-all">{JSON.stringify(r.sanitizedDiff)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secondary" href={`?pagina=${page - 1}`}>Anterior</Link>}
        {rows.length === 50 && <Link className="btn-secondary" href={`?pagina=${page + 1}`}>Próxima</Link>}
      </div>
    </div>
  );
}
