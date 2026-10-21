import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { classificationPreview, taxonomy } from "@/modules/catalog/service";
import { can, requirePageContext } from "@/server/tenant-context";
import { BrandProposals, CategoryProposals, FillModels, TaxonomyEditor } from "./catalog-client";

export const metadata: Metadata = { title: "Organizar catálogo" };

export default async function CatalogPage({ params }: PageProps<"/[tenantSlug]/catalogo">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "products:write")) return <NoPermission />;
  const [preview, tax] = await Promise.all([classificationPreview(ctx), taxonomy(ctx)]);
  const base = `/${ctx.tenantSlug}/produtos`;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Organizar catálogo</h1>
      <p className="text-sm text-slate-600">
        {preview.total.toLocaleString("pt-BR")} produtos ativos/rascunho · {preview.alreadyCategorized.toLocaleString("pt-BR")} com categoria ·{" "}
        <Link className="underline" href={`${base}?categoria=none`}>{(preview.total - preview.alreadyCategorized).toLocaleString("pt-BR")} sem categoria</Link> ·{" "}
        <Link className="underline" href={`${base}?marca=none`}>ver produtos sem marca</Link>
      </p>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">1. Categorias propostas</h2>
          <p className="text-xs text-slate-500">
            Propostas por palavras-chave da descrição (regras {preview.rulesVersion}). Confira as amostras, desmarque o que não fizer sentido e aplique. Só produtos <strong>sem categoria</strong> são alterados; tudo é auditado e pode ser corrigido depois.
          </p>
        </div>
        <CategoryProposals tenantSlug={ctx.tenantSlug} groups={preview.categories} />
        {preview.unmatched.count > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">{preview.unmatched.count} produto(s) sem regra — classificar manualmente</summary>
            <ul className="mt-1 columns-1 text-xs text-slate-600 md:columns-2">
              {preview.unmatched.samples.map((s) => <li key={s.sku}><span className="font-mono">{s.sku}</span> {s.name}</li>)}
            </ul>
            <Link className="mt-1 inline-block text-xs underline" href={`${base}?categoria=none&vista=tabela`}>Abrir todos sem categoria (com edição em massa)</Link>
          </details>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">2. Marcas citadas na descrição</h2>
          <p className="text-xs text-slate-500">Só quando o nome do produto cita a marca explicitamente. Não há inferência por código ou família.</p>
        </div>
        <BrandProposals tenantSlug={ctx.tenantSlug} groups={preview.brands} />
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">3. Modelos sugeridos</h2>
        <p className="text-xs text-slate-500">Extrai da descrição um modelo provável (ex.: “VIP 1230 B G5”) para melhorar a pesquisa de preços. Fica só como sugestão; o campo Modelo do produto não muda.</p>
        <FillModels tenantSlug={ctx.tenantSlug} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">4. Cadastros</h2>
        <TaxonomyEditor tenantSlug={ctx.tenantSlug} brands={tax.brands} categories={tax.categories} tags={tax.tags} />
      </section>
    </div>
  );
}
