import type { Metadata } from "next";
import { getFacets } from "@/modules/products/service";
import { NoPermission } from "@/components/no-permission";
import { can, requirePageContext } from "@/server/tenant-context";
import { emptyProduct, ProductForm } from "../product-form";


export const metadata: Metadata = { title: "Cadastrar produto" };

export default async function NewProductPage({ params }: PageProps<"/[tenantSlug]/produtos/novo">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "products:write")) return <NoPermission />;
  const facets = await getFacets(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cadastrar produto</h1>
      <p className="text-sm text-slate-600">Salve o rascunho primeiro; em seguida você poderá enviar as fotos.</p>
      <ProductForm
        tenantSlug={ctx.tenantSlug}
        initial={emptyProduct}
        suggestions={{ brands: facets.brands.map((b) => b.name), categories: facets.categories.map((c) => c.name) }}
      />
    </div>
  );
}
