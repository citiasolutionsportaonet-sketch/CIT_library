import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { ROLE_LABEL } from "@/server/permissions";
import { can, requirePageContext } from "@/server/tenant-context";

export default async function TenantLayout({ children, params }: LayoutProps<"/[tenantSlug]">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href={`/${ctx.tenantSlug}/produtos`} className="font-semibold">
            CIT Library <span className="font-normal text-slate-500">· {ctx.tenantName}</span>
          </Link>
          <nav className="flex flex-wrap gap-x-3 gap-y-2 text-sm">
            <Link href={`/${ctx.tenantSlug}/vitrine`} className="font-semibold text-emerald-800 hover:underline">Vitrine</Link>
            <Link href={`/${ctx.tenantSlug}/produtos`} className="text-slate-700 hover:underline">Produtos</Link>
            {can(ctx, "products:write") && (
              <Link href={`/${ctx.tenantSlug}/catalogo`} className="text-slate-700 hover:underline">Organizar</Link>
            )}
            {can(ctx, "research:review") && (
              <Link href={`/${ctx.tenantSlug}/pesquisa`} className="text-slate-700 hover:underline">Pesquisa</Link>
            )}
            {can(ctx, "imports:write") && (
              <Link href={`/${ctx.tenantSlug}/importacoes`} className="text-slate-700 hover:underline">Importações</Link>
            )}
            {can(ctx, "members:manage") && (
              <Link href={`/${ctx.tenantSlug}/configuracoes`} className="text-slate-700 hover:underline">Configurações</Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <span>
              {ctx.userName} · {ROLE_LABEL[ctx.role]}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
