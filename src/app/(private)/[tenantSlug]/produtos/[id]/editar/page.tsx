import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { getFacets, getProduct } from "@/modules/products/service";
import { getEnv } from "@/server/env";
import { can, requirePageContext } from "@/server/tenant-context";
import { PhotoManager } from "../../photo-manager";
import { ProductForm } from "../../product-form";
import { toFormValues } from "../../to-form";
import { loadOr404 } from "../load";

export const metadata: Metadata = { title: "Editar produto" };

export default async function EditProductPage({ params, searchParams }: PageProps<"/[tenantSlug]/produtos/[id]/editar">) {
  const { tenantSlug, id } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "products:write")) return <NoPermission />;
  const [p, facets] = await Promise.all([loadOr404(() => getProduct(ctx, id)), getFacets(ctx)]);
  const isNew = (await searchParams).novo === "1";
  if (p.status === "ARCHIVED") {
    return (
      <div className="card p-6 text-sm">
        Produto arquivado. <Link className="underline" href={`/${ctx.tenantSlug}/produtos/${p.id}`}>Abra o produto</Link> e restaure-o para editar.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/${ctx.tenantSlug}/produtos/${p.id}`} className="text-sm text-slate-600 hover:underline">← {p.name}</Link>
        <h1 className="text-xl font-semibold">Editar produto</h1>
        <p className="text-xs text-slate-500">Versão {p.version}</p>
      </div>
      {isNew && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">Rascunho salvo. Agora adicione as fotos.</p>}
      <PhotoManager
        tenantSlug={ctx.tenantSlug}
        productId={p.id}
        photos={p.media.map((m) => ({ id: m.id, altText: m.altText, originalName: m.originalName, width: m.width, height: m.height }))}
        coverMediaId={p.coverMediaId}
        maxPhotos={getEnv().MEDIA_MAX_PER_PRODUCT}
      />
      <ProductForm
        key={p.version}
        tenantSlug={ctx.tenantSlug}
        productId={p.id}
        version={p.version}
        initial={toFormValues(p)}
        suggestions={{ brands: facets.brands.map((b) => b.name), categories: facets.categories.map((c) => c.name) }}
      />
    </div>
  );
}
