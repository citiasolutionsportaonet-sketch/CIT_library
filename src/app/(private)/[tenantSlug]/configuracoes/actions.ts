"use server";

import { randomUUID } from "node:crypto";
import { createCredential, revokeCredential } from "@/modules/api/credentials";
import { updateMarkup } from "@/modules/pricing/service";
import { changeMemberRole, createInvitation, revokeInvitation, setMemberActive } from "@/modules/tenants/service";
import { getEnv } from "@/server/env";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { loadTenantContext, type TenantContext } from "@/server/tenant-context";

async function run<T>(tenantSlug: string, fn: (ctx: TenantContext) => Promise<T>): Promise<ActionResult<T>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    return { ok: true, data: await fn(ctx) };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export async function inviteAction(tenantSlug: string, email: string, role: string) {
  return run(tenantSlug, async (ctx) => {
    const { token, expiresAt } = await createInvitation(ctx, email, role);
    // Link montado com a URL canônica configurada (não com o Host da requisição).
    const base = getEnv().APP_ORIGIN.replace(/\/$/, "");
    return { link: `${base}/convite/${token}`, expiresAt: expiresAt.toISOString() };
  });
}

export async function revokeInviteAction(tenantSlug: string, id: string) {
  return run(tenantSlug, (ctx) => revokeInvitation(ctx, String(id)));
}

export async function changeRoleAction(tenantSlug: string, membershipId: string, role: string) {
  return run(tenantSlug, (ctx) => changeMemberRole(ctx, String(membershipId), role));
}

export async function setActiveAction(tenantSlug: string, membershipId: string, active: boolean) {
  return run(tenantSlug, (ctx) => setMemberActive(ctx, String(membershipId), Boolean(active)));
}


export async function updateMarkupAction(tenantSlug: string, percent: string) {
  return run(tenantSlug, (ctx) => updateMarkup(ctx, percent));
}

export async function createApiCredentialAction(tenantSlug: string, name: string, scopes: string[], expiresInDays: number | null) {
  return run(tenantSlug, async (ctx) => {
    const c = await createCredential(ctx, { name, scopes, expiresInDays });
    return { token: c.token, scopes: c.scopes };
  });
}

export async function revokeApiCredentialAction(tenantSlug: string, id: string) {
  return run(tenantSlug, (ctx) => revokeCredential(ctx, String(id)));
}
