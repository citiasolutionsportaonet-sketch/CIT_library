import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { normalizeEmail, slugify } from "@/lib/normalize";
import { createCredentialUser } from "@/modules/auth/users";
import { audit } from "@/server/audit";
import { getDb, type Tx } from "@/server/db";
import { DomainError, forbidden, notFound, validation } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { canManageRole } from "@/server/permissions";
import { assertCan, type TenantContext } from "@/server/authorize";

export const INVITE_TTL_HOURS = 72;
const ROLES: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

function parseRole(raw: unknown): Role {
  if (typeof raw !== "string" || !ROLES.includes(raw as Role)) throw validation({ role: "Papel inválido." });
  return raw as Role;
}

// ---------------------------------------------------------------------------
// Bootstrap (primeiro uso) — chamado somente pelo script administrativo
// ---------------------------------------------------------------------------

export async function bootstrapOwner(input: { tenantName: string; tenantSlug?: string; name: string; email: string; password: string }) {
  const tenantName = input.tenantName.trim();
  const slug = input.tenantSlug ? slugify(input.tenantSlug) : slugify(tenantName);
  if (!tenantName || !slug) throw validation({ tenantName: "Informe o nome da organização." });
  return writeTx(async (tx) => {
    // Serializa bootstraps concorrentes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7310002)`;
    let tenant = await tx.tenant.findUnique({ where: { slug } });
    if (tenant) {
      const owner = await tx.membership.findFirst({ where: { tenantId: tenant.id, role: "OWNER", active: true } });
      if (owner) return { status: "exists" as const, tenantSlug: slug };
    } else {
      tenant = await tx.tenant.create({ data: { name: tenantName, slug } });
    }
    const email = normalizeEmail(input.email);
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    // Usuário já existente vira OWNER sem ter a senha alterada.
    const user = existing ?? (await createCredentialUser(tx, { name: input.name, email, password: input.password }));
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      create: { tenantId: tenant.id, userId: user.id, role: "OWNER" },
      update: { role: "OWNER", active: true },
    });
    await audit(tx, { tenantId: tenant.id, actorId: null, requestId: "bootstrap", action: "tenant.bootstrap", entityType: "Tenant", entityId: tenant.id, diff: { ownerEmail: email, reusedUser: !!existing } });
    return { status: "created" as const, tenantSlug: slug, reusedUser: !!existing };
  });
}

// ---------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------

export async function listMembers(ctx: TenantContext) {
  assertCan(ctx, "members:manage");
  const db = getDb();
  const [members, invitations] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, role: true, active: true, createdAt: true, user: { select: { id: true, name: true, email: true, active: true } } },
    }),
    db.invitation.findMany({
      where: { tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);
  return { members, invitations };
}

async function lockOwners(tx: Tx, tenantId: string) {
  return tx.$queryRaw<{ id: string; userId: string }[]>`
    SELECT "id", "userId" FROM "membership"
    WHERE "tenantId" = ${tenantId}::uuid AND "role" = 'OWNER' AND "active" = true
    FOR UPDATE`;
}

async function loadTarget(tx: Tx, ctx: TenantContext, membershipId: string) {
  const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId } });
  if (!m) throw notFound("Membro");
  if (m.userId === ctx.userId) throw new DomainError("FORBIDDEN", "Você não pode alterar o seu próprio acesso.");
  if (!canManageRole(ctx.role, m.role)) throw forbidden();
  return m;
}

export async function changeMemberRole(ctx: TenantContext, membershipId: string, rawRole: unknown) {
  assertCan(ctx, "members:manage");
  const role = parseRole(rawRole);
  if (!canManageRole(ctx.role, role)) throw forbidden();
  await writeTx(async (tx) => {
    const owners = await lockOwners(tx, ctx.tenantId);
    const m = await loadTarget(tx, ctx, membershipId);
    if (m.role === "OWNER" && role !== "OWNER" && m.active && owners.length <= 1) {
      throw new DomainError("CONFLICT", "A organização precisa de pelo menos um proprietário ativo.");
    }
    await tx.membership.update({ where: { id: m.id }, data: { role } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "member.role", entityType: "Membership", entityId: m.id, diff: { de: m.role, para: role } });
  });
}

export async function setMemberActive(ctx: TenantContext, membershipId: string, active: boolean) {
  assertCan(ctx, "members:manage");
  await writeTx(async (tx) => {
    const owners = await lockOwners(tx, ctx.tenantId);
    const m = await loadTarget(tx, ctx, membershipId);
    if (!active && m.role === "OWNER" && m.active && owners.length <= 1) {
      throw new DomainError("CONFLICT", "Não é possível desativar o último proprietário.");
    }
    await tx.membership.update({ where: { id: m.id }, data: { active } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: active ? "member.activate" : "member.deactivate", entityType: "Membership", entityId: m.id });
  });
}

// ---------------------------------------------------------------------------
// Convites (sem SMTP: o link é exibido uma única vez a OWNER/ADMIN)
// ---------------------------------------------------------------------------

export async function createInvitation(ctx: TenantContext, rawEmail: unknown, rawRole: unknown): Promise<{ token: string; expiresAt: Date }> {
  assertCan(ctx, "members:manage");
  const email = normalizeEmail(String(rawEmail ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw validation({ email: "E-mail inválido." });
  const role = parseRole(rawRole);
  if (!canManageRole(ctx.role, role)) throw forbidden();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);
  await writeTx(async (tx) => {
    const member = await tx.membership.findFirst({ where: { tenantId: ctx.tenantId, active: true, user: { email } } });
    if (member) throw new DomainError("CONFLICT", "Esta pessoa já é membro ativo da organização.", { email: "Já é membro." });
    // Um convite pendente por e-mail: os anteriores são revogados.
    await tx.invitation.updateMany({ where: { tenantId: ctx.tenantId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await tx.invitation.create({ data: { tenantId: ctx.tenantId, email, role, tokenHash: hashToken(token), expiresAt, createdById: ctx.userId } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "invitation.create", entityType: "Invitation", entityId: inv.id, diff: { email, role } });
  });
  return { token, expiresAt };
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string) {
  assertCan(ctx, "members:manage");
  await writeTx(async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId, tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null } });
    if (!inv) throw notFound("Convite");
    if (!canManageRole(ctx.role, inv.role)) throw forbidden();
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "invitation.revoke", entityType: "Invitation", entityId: inv.id });
  });
}

/** Consulta pública do convite (somente dados mínimos para a tela de aceite). */
export async function peekInvitation(token: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const inv = await getDb().invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, tenant: { select: { name: true, slug: true, status: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date() || inv.tenant.status !== "ACTIVE") return null;
  const userExists = !!(await getDb().user.findUnique({ where: { email: inv.email }, select: { id: true } }));
  return { email: inv.email, role: inv.role, tenantName: inv.tenant.name, tenantSlug: inv.tenant.slug, expiresAt: inv.expiresAt, userExists };
}

/**
 * Aceite de uso único. Novo usuário define nome e senha; usuário existente
 * precisa estar logado com o mesmo e-mail do convite.
 */
export async function acceptInvitation(
  token: string,
  opts: { sessionUserId: string | null; name?: string; password?: string },
): Promise<{ tenantSlug: string; email: string; createdUser: boolean }> {
  return writeTx(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "invitation" WHERE "tokenHash" = ${hashToken(String(token))} FOR UPDATE`;
    const inv = rows[0] ? await tx.invitation.findUnique({ where: { id: rows[0].id }, include: { tenant: true } }) : null;
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date() || inv.tenant.status !== "ACTIVE") {
      throw new DomainError("NOT_FOUND", "Convite inválido, expirado ou já utilizado. Peça um novo convite.");
    }
    const existing = await tx.user.findUnique({ where: { email: inv.email }, select: { id: true, active: true } });
    let userId: string;
    let createdUser = false;
    if (existing) {
      if (!existing.active) throw new DomainError("FORBIDDEN", "Usuário desativado. Fale com um administrador.");
      if (opts.sessionUserId !== existing.id) {
        throw new DomainError("UNAUTHENTICATED", "Já existe uma conta com este e-mail. Entre com ela e abra o link do convite novamente.");
      }
      userId = existing.id;
    } else {
      const u = await createCredentialUser(tx, { name: opts.name ?? "", email: inv.email, password: opts.password ?? "" });
      userId = u.id;
      createdUser = true;
    }
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: inv.tenantId, userId } },
      create: { tenantId: inv.tenantId, userId, role: inv.role },
      update: { role: inv.role, active: true },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await audit(tx, { tenantId: inv.tenantId, actorId: userId, requestId: `invite:${inv.id}`, action: "invitation.accept", entityType: "Invitation", entityId: inv.id, diff: { email: inv.email, role: inv.role, createdUser } });
    return { tenantSlug: inv.tenant.slug, email: inv.email, createdUser };
  });
}

export async function listAudit(ctx: TenantContext, page = 1) {
  assertCan(ctx, "audit:read");
  const take = 50;
  const db = getDb();
  const rows = await db.auditEvent.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (Math.max(1, page) - 1) * take,
    take,
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  return rows.map((r) => ({ ...r, actorName: actors.find((a) => a.id === r.actorId)?.name ?? (r.actorId ? "Usuário removido" : "Sistema") }));
}

export async function myTenants(userId: string) {
  return getDb().membership.findMany({
    where: { userId, active: true, tenant: { status: "ACTIVE" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true, tenant: { select: { slug: true, name: true } } },
  });
}
