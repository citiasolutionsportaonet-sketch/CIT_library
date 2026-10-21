import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_LABEL } from "@/lib/format";
import { formatBRL } from "@/modules/pricing/calc";
import { pricingFor } from "@/modules/pricing/service";
import { taxonomy } from "@/modules/catalog/service";
import { getFacets, listProducts, SORTS, type Sort } from "@/modules/products/service";
import { can, requirePageContext } from "@/server/tenant-context";
import { BulkPanel } from "./bulk-panel";
import { CatalogFilters } from "./catalog-filters";

export const metadata: Metadata = { title: "Produtos" };

const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED", "ALL"] as const;
const RESEARCH = ["PENDING", "QUEUED", "IN_PROGRESS", "NEEDS_REVIEW", "ENRICHED", "NO_DATA", "FAILED"] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProductsPage({ params, searchParams }: PageProps<"/[tenantSlug]/produtos">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === one(sp.status));
  const sort = SORTS.find((s) => s === one(sp.ordem)) as Sort | undefined;
  const view = one(sp.vista) === "tabela" ? "tabela" : "grade";
  const filter = {
    q: one(sp.q),
    brandId: one(sp.marca),
    categoryId: one(sp.categoria),
    tagId: one(sp.tag),
    status,
    researchStatus: RESEARCH.find((r) => r === one(sp.pesquisa)),
  };
  const [result, facets, tax] = await Promise.all([
    listProducts(ctx, {
      q: one(sp.q),
      brandId: one(sp.marca),
      categoryId: one(sp.categoria),
      tagId: one(sp.tag),
      status,
      researchStatus: RESEARCH.find((r) => r === one(sp.pesquisa)),
      sort,
      page: Number(one(sp.pagina) ?? 1) || 1,
      pageSize: Number(one(sp.por) ?? 24) || 24,
    }),
    getFacets(ctx),
    taxonomy(ctx),
  ]);
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && ["q", "marca", "categoria", "tag", "status", "pesquisa"].includes(k)) as [string, string][]).toString();
  const prices = await pricingFor(ctx, result.items.map((i) => i.id));
  const showCost = can(ctx, "costs:read");
  const base = `/${ctx.tenantSlug}/produtos`;
  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "pagina") u.set(k, v);
    if (p > 1) u.set("pagina", String(p));
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  const writable = can(ctx, "products:write");
  const empty = result.total === 0 && !one(sp.q) && !one(sp.marca) && !one(sp.categoria) && !one(sp.tag) && !status && !one(sp.pesquisa);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Produtos</h1>
        <span className="text-sm text-slate-500">{result.total} encontrado(s)</span>
        <a href={`/api/t/${ctx.tenantSlug}/export/produtos${exportQs ? `?${exportQs}` : ""}`} className="btn-secondary ml-auto">Exportar CSV</a>
        {writable && (
          <Link href={`${base}/novo`} className="btn-primary">
            Cadastrar produto
          </Link>
        )}
      </div>

      {empty ? (
        <div className="card p-10 text-center">
          <p className="mb-4 text-slate-600">Nenhum produto cadastrado ainda.</p>
          {writable ? (
            <Link href={`${base}/novo`} className="btn-primary">Cadastrar produto</Link>
          ) : (
            <p className="text-sm text-slate-500">Seu papel é somente leitura.</p>
          )}
        </div>
      ) : (
        <>
          <CatalogFilters facets={{ ...facets, categories: tax.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.path })) }} />
          {writable && result.total > 0 && (
            <BulkPanel
              tenantSlug={ctx.tenantSlug}
              filter={filter}
              total={result.total}
              categories={tax.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.path }))}
              brands={tax.brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
            />
          )}
          {result.items.length === 0 ? (
            <div className="card p-8 text-center text-slate-600">Nenhum produto corresponde aos filtros.</div>
          ) : view === "grade" ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {result.items.map((p) => (
                <li key={p.id} className="card overflow-hidden">
                  <Link href={`${base}/${p.id}`} className="block">
                    <div className="flex aspect-square items-center justify-center bg-slate-100">
                      {p.coverMediaId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/media/${p.coverMediaId}?v=thumb`} alt="" className="h-full w-full object-contain" loading="lazy" />
                      ) : (
                        <span className="text-xs text-slate-400">Sem foto</span>
                      )}
                    </div>
                    <div className="space-y-0.5 p-3 text-sm">
                      <p className="line-clamp-2 font-medium">{p.name}</p>
                      <p className="text-xs text-slate-500">{[p.brand?.name, p.model].filter(Boolean).join(" · ") || "—"}</p>
                      <p className="font-mono text-xs text-slate-500">{p.sku}</p>
                      <p className="text-sm font-semibold">{prices.get(p.id)?.citPrice ? formatBRL(prices.get(p.id)!.citPrice) : <span className="text-xs font-normal text-slate-400">sem preço</span>}</p>
                      <StatusBadge status={p.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2 w-14"></th>
                    <th className="p-2">Nome</th>
                    <th className="p-2">Marca</th>
                    <th className="p-2">Modelo</th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">Categoria</th>
                    {showCost && <th className="p-2 text-right">Custo</th>}
                    <th className="p-2 text-right">Preço CIT</th>
                    <th className="p-2 text-right">Mediana web</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="p-2">
                        {p.coverMediaId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/media/${p.coverMediaId}?v=thumb`} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-slate-100" />
                        )}
                      </td>
                      <td className="p-2"><Link className="font-medium hover:underline" href={`${base}/${p.id}`}>{p.name}</Link></td>
                      <td className="p-2">{p.brand?.name ?? "—"}</td>
                      <td className="p-2">{p.model ?? "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.sku}</td>
                      <td className="p-2">{p.category?.name ?? "—"}</td>
                      {showCost && <td className="p-2 text-right whitespace-nowrap">{formatBRL(prices.get(p.id)?.cost)}</td>}
                      <td className="p-2 text-right whitespace-nowrap font-medium">{formatBRL(prices.get(p.id)?.citPrice)}</td>
                      <td className="p-2 text-right whitespace-nowrap">{formatBRL(prices.get(p.id)?.marketMedian)}</td>
                      <td className="p-2"><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.pageCount > 1 && (
            <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Paginação">
              {result.page > 1 ? <Link className="btn-secondary" href={pageHref(result.page - 1)}>Anterior</Link> : <span className="btn-secondary opacity-50">Anterior</span>}
              <span>Página {result.page} de {result.pageCount}</span>
              {result.page < result.pageCount ? <Link className="btn-secondary" href={pageHref(result.page + 1)}>Próxima</Link> : <span className="btn-secondary opacity-50">Próxima</span>}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  const color = status === "ACTIVE" ? "bg-green-100 text-green-800" : status === "ARCHIVED" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-800";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${color}`}>{STATUS_LABEL[status]}</span>;
}
