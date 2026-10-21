import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";
import { getDb } from "./db";
import type { TenantContext } from "./authorize";
import { DomainError, unauthenticated } from "./errors";
import { permissionsFor } from "./permissions";

export { assertCan, can, type TenantContext } from "./authorize";

export type SessionUser = { id: string; name: string; email: string };


/** Sessão validada no banco a cada requisição; usuário inativo = sem sessão. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!user?.active) return null;
  return { id: user.id, name: user.name, email: user.email };
});

/**
 * Resolve tenant pelo slug da rota + membership ativa do usuário autenticado.
 * Tenant inexistente e tenant sem acesso retornam o mesmo 404.
 */
export const loadTenantContext = cache(async (tenantSlug: string): Promise<TenantContext> => {
  const user = await getSessionUser();
  if (!user) throw unauthenticated();
  const membership = await getDb().membership.findFirst({
    where: { userId: user.id, active: true, tenant: { slug: tenantSlug, status: "ACTIVE" } },
    select: { role: true, tenant: { select: { id: true, slug: true, name: true, timezone: true } } },
  });
  if (!membership) throw new DomainError("NOT_FOUND", "Organização não encontrada.");
  return {
    tenantId: membership.tenant.id,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    timezone: membership.tenant.timezone,
    userId: user.id,
    userName: user.name,
    role: membership.role,
    permissions: permissionsFor(membership.role),
    requestId: randomUUID(),
  };
});

/** Para Server Components: redireciona ao login ou responde 404. */
export async function requirePageContext(tenantSlug: string): Promise<TenantContext> {
  try {
    return await loadTenantContext(tenantSlug);
  } catch (err) {
    if (err instanceof DomainError && err.code === "UNAUTHENTICATED") redirect("/login");
    if (err instanceof DomainError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
