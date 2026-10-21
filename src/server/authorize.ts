import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { forbidden } from "./errors";
import type { Capability } from "./permissions";

/** Contexto obrigatório de toda operação de domínio. */
export type TenantContext = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  timezone: string;
  userId: string;
  userName: string;
  role: Role;
  permissions: ReadonlySet<Capability>;
  requestId: string;
};

export function can(ctx: TenantContext, cap: Capability): boolean {
  return ctx.permissions.has(cap);
}

export function assertCan(ctx: TenantContext, cap: Capability): void {
  if (!ctx.permissions.has(cap)) throw forbidden();
}
