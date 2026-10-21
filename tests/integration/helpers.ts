import { randomUUID } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import type { TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { permissionsFor } from "@/server/permissions";

export function assertTestDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!process.env.CIT_TEST || !/_test(\?|$)/.test(new URL(url).pathname + "")) {
    throw new Error("Integração só roda via npm run test:integration (banco *_test).");
  }
}

export async function makeTenant(slug = `t-${randomUUID().slice(0, 8)}`) {
  return getDb().tenant.create({ data: { name: slug.toUpperCase(), slug } });
}

export async function makeUser(name = "Pessoa") {
  return getDb().user.create({ data: { name, email: `${randomUUID().slice(0, 8)}@teste.local` } });
}

export async function makeCtx(tenant: { id: string; slug: string; name: string }, role: Role, userId?: string): Promise<TenantContext> {
  const uid = userId ?? (await makeUser(role)).id;
  await getDb().membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: uid } },
    create: { tenantId: tenant.id, userId: uid, role },
    update: { role, active: true },
  });
  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    timezone: "America/Sao_Paulo",
    userId: uid,
    userName: role,
    role,
    permissions: permissionsFor(role),
    requestId: randomUUID(),
  };
}

export function streamOf(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(buf));
      c.close();
    },
  });
}
