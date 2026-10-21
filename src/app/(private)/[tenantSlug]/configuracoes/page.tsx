import type { Metadata } from "next";
import Link from "next/link";
import { NoPermission } from "@/components/no-permission";
import { formatDateTime } from "@/lib/format";
import { API_SCOPES, listCredentials } from "@/modules/api/credentials";
import { getPricingConfig } from "@/modules/pricing/service";
import { listMembers } from "@/modules/tenants/service";
import { ROLE_LABEL } from "@/server/permissions";
import { can, requirePageContext } from "@/server/tenant-context";
import { InviteForm, MemberControls, RevokeInvite } from "./members-client";
import { ApiCredentials, MarkupForm } from "./settings-client";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage({ params }: PageProps<"/[tenantSlug]/configuracoes">) {
  const { tenantSlug } = await params;
  const ctx = await requirePageContext(tenantSlug);
  if (!can(ctx, "members:manage") && !can(ctx, "pricing:configure")) return <NoPermission />;
  const { members, invitations } = await listMembers(ctx);
  const pricing = await getPricingConfig(ctx.tenantId);
  const creds = can(ctx, "api:manage") ? await listCredentials(ctx) : [];
  const assignable = (["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const).filter((r) => ctx.role === "OWNER" || r !== "OWNER");
  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <h1 className="text-xl font-semibold">Configurações · {ctx.tenantName}</h1>
        {can(ctx, "audit:read") && <Link href={`/${ctx.tenantSlug}/configuracoes/auditoria`} className="btn-secondary ml-auto">Auditoria</Link>}
      </div>

      {can(ctx, "pricing:configure") && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Precificação</h2>
          <p className="text-sm text-slate-600">
            Preço CIT = custo do distribuidor × (1 + markup). Limite: 0% a 45%. A referência comercial de mercado (mediana online + {pricing.webUplift.times(100).toFixed(0)}%) é calculada à parte e nunca substitui o Preço CIT.
            Mediana usa ofertas aceitas dos últimos {pricing.offerMaxAgeDays} dias; mínimo recomendado de {pricing.minOffersForMedian} ofertas.
          </p>
          <MarkupForm tenantSlug={ctx.tenantSlug} currentPercent={pricing.markup.times(100).toFixed(2)} />
        </section>
      )}

      {can(ctx, "api:manage") && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">API para outros sistemas</h2>
          <p className="text-sm text-slate-600">Credenciais para CIT Projects, CitCondo, CITGuard e SysGuard. O segredo aparece uma única vez. Contrato: <a className="underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>.</p>
          <ApiCredentials
            tenantSlug={ctx.tenantSlug}
            scopes={Object.entries(API_SCOPES).map(([id, label]) => ({ id, label }))}
            items={creds.map((c) => ({ id: c.id, name: c.name, prefix: c.prefix, scopes: c.scopes, expiresAt: c.expiresAt ? formatDateTime(c.expiresAt, ctx.timezone) : null, revoked: !!c.revokedAt, lastUsedAt: c.lastUsedAt ? formatDateTime(c.lastUsedAt, ctx.timezone) : null }))}
          />
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Membros</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr><th className="py-2">Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th></th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-2">{m.user.name}</td>
                <td>{m.user.email}</td>
                <td>{ROLE_LABEL[m.role]}</td>
                <td>{m.active && m.user.active ? "Ativo" : "Inativo"}</td>
                <td className="py-2">
                  {m.user.id !== ctx.userId && (ctx.role === "OWNER" || m.role !== "OWNER") ? (
                    <MemberControls tenantSlug={ctx.tenantSlug} membershipId={m.id} role={m.role} active={m.active} assignable={[...assignable]} />
                  ) : (
                    <span className="text-xs text-slate-400">{m.user.id === ctx.userId ? "Você" : "Somente proprietário"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Convidar pessoa</h2>
        <p className="text-sm text-slate-600">
          Não há envio de e-mail configurado. O link do convite aparece uma única vez: copie e envie por um canal confiável. Ele expira em 72 horas e só pode ser usado uma vez.
        </p>
        <InviteForm tenantSlug={ctx.tenantSlug} roles={[...assignable]} />
        {invitations.length > 0 && (
          <div>
            <h3 className="mb-1 mt-4 text-sm font-semibold">Convites pendentes</h3>
            <ul className="space-y-1 text-sm">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  {i.email} · {ROLE_LABEL[i.role]} · expira {formatDateTime(i.expiresAt, ctx.timezone)}
                  {(ctx.role === "OWNER" || i.role !== "OWNER") && <RevokeInvite tenantSlug={ctx.tenantSlug} id={i.id} />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
