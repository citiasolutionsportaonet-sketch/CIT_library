import type { Metadata } from "next";
import { requirePageContext } from "@/server/tenant-context";
import { loadShowcase } from "@/modules/showcase/service";
import { ShowcaseView } from "@/modules/showcase/view";
import "@/modules/showcase/showcase.css";

export const metadata: Metadata = { title: "Vitrine de produtos" };
const one = (s: string | string[] | undefined) => (Array.isArray(s) ? s[0] : s);

export default async function ShowcasePage({
  params,
  searchParams,
}: PageProps<"/[tenantSlug]/vitrine">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  const sp = await searchParams;
  const order = one(sp.ordem);
  const data = await loadShowcase(ctx, {
    q: one(sp.q),
    category: one(sp.categoria),
    brand: one(sp.marca),
    photo: one(sp.foto) === "1",
    sort: order === "nome" || order === "recentes" ? order : "destaques",
    page: Number(one(sp.pagina) ?? 1),
  });
  return (
    <ShowcaseView
      data={data}
      base={`/${ctx.tenantSlug}/vitrine`}
      mode={one(sp.modo) === "dados" ? "dados" : "catalogo"}
    />
  );
}
