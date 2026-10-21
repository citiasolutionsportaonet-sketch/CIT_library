import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cleanText } from "@/lib/normalize";
import { audit } from "@/server/audit";
import { assertCan, type TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { DomainError, notFound, validation } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { consumeRateLimit } from "@/server/rate-limit";

export const API_SCOPES = {
  "catalog:read": "Produtos, especificações, imagens e documentos aprovados",
  "prices:read": "Preço CIT e comparação de mercado (sem custo)",
  "costs:read": "Custo no distribuidor (interno — conceda só a sistemas internos)",
} as const;
export type ApiScope = keyof typeof API_SCOPES;

const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Cria credencial. O segredo completo é devolvido UMA vez e nunca gravado. */
export async function createCredential(ctx: TenantContext, input: { name: string; scopes: string[]; expiresInDays?: number | null }) {
  assertCan(ctx, "api:manage");
  const name = cleanText(input.name ?? "").slice(0, 80);
  if (!name) throw validation({ name: "Informe um nome (ex.: CIT Projects)." });
  const scopes = [...new Set(input.scopes)].filter((s): s is ApiScope => s in API_SCOPES);
  if (!scopes.includes("catalog:read")) throw validation({ scopes: "O escopo catalog:read é obrigatório." });
  const days = input.expiresInDays ? Math.floor(Number(input.expiresInDays)) : null;
  if (days !== null && !(days >= 1 && days <= 730)) throw validation({ expiresInDays: "Validade entre 1 e 730 dias." });
  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `cit_${prefix}_${secret}`;
  const cred = await writeTx(async (tx) => {
    const c = await tx.apiCredential.create({
      data: { tenantId: ctx.tenantId, name, prefix, tokenHash: hash(token), scopes, expiresAt: days ? new Date(Date.now() + days * 86400_000) : null, createdById: ctx.userId },
    });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "api.credential.create", entityType: "ApiCredential", entityId: c.id, diff: { name, scopes, prefix, expiresAt: c.expiresAt } });
    return c;
  });
  return { id: cred.id, token, prefix, scopes };
}

export async function listCredentials(ctx: TenantContext) {
  assertCan(ctx, "api:manage");
  return getDb().apiCredential.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true },
  });
}

export async function revokeCredential(ctx: TenantContext, id: string) {
  assertCan(ctx, "api:manage");
  await writeTx(async (tx) => {
    const c = await tx.apiCredential.findFirst({ where: { id, tenantId: ctx.tenantId, revokedAt: null } });
    if (!c) throw notFound("Credencial");
    await tx.apiCredential.update({ where: { id: c.id }, data: { revokedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "api.credential.revoke", entityType: "ApiCredential", entityId: c.id, diff: { prefix: c.prefix } });
  });
}

export type ApiPrincipal = { tenantId: string; credentialId: string; scopes: Set<ApiScope>; requestId: string };

/** Autentica `Authorization: Bearer cit_<prefix>_<segredo>`. Tenant vem só da credencial. */
export async function authenticateApi(req: Request, requestId: string): Promise<ApiPrincipal> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer (cit_([a-f0-9]{12})_[A-Za-z0-9_-]{43})$/.exec(h);
  if (!m) throw new DomainError("UNAUTHENTICATED", "Credencial ausente ou malformada (use Authorization: Bearer cit_…).");
  const cred = await getDb().apiCredential.findUnique({ where: { prefix: m[2] }, include: { tenant: { select: { status: true } } } });
  const ok = cred && timingSafeEqual(Buffer.from(cred.tokenHash, "hex"), Buffer.from(hash(m[1]), "hex"));
  if (!cred || !ok || cred.revokedAt || (cred.expiresAt && cred.expiresAt <= new Date()) || cred.tenant.status !== "ACTIVE") {
    throw new DomainError("UNAUTHENTICATED", "Credencial inválida, expirada ou revogada.");
  }
  const rl = await consumeRateLimit(`api:${cred.id}`, 60, Number(process.env.API_RATE_PER_MINUTE ?? 120));
  if (!rl.allowed) throw new DomainError("RATE_LIMITED", `Limite de requisições atingido. Tente em ${rl.retryAfter}s.`);
  if (!cred.lastUsedAt || Date.now() - cred.lastUsedAt.getTime() > 60_000) {
    await getDb().apiCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { tenantId: cred.tenantId, credentialId: cred.id, scopes: new Set(cred.scopes as ApiScope[]), requestId };
}

export function requireScope(p: ApiPrincipal, scope: ApiScope) {
  if (!p.scopes.has(scope)) throw new DomainError("FORBIDDEN", `Credencial sem o escopo ${scope}.`);
}
