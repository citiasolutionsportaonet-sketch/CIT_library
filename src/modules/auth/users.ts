import "server-only";
import { normalizeEmail } from "@/lib/normalize";
import { getAuth } from "@/server/auth";
import type { Tx } from "@/server/db";
import { DomainError, validation } from "@/server/errors";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function checkPassword(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    throw validation({ password: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.` });
  }
  if (password.length > PASSWORD_MAX) throw validation({ password: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.` });
}

/** Hash pela API de senha do Better Auth (mesmo formato do login). */
export async function hashPassword(password: string): Promise<string> {
  checkPassword(password);
  const ctx = await getAuth().$context;
  return ctx.password.hash(password);
}

/**
 * Cria usuário + conta "credential" na transação recebida, no mesmo formato
 * que o Better Auth usa no cadastro por e-mail/senha (accountId = userId).
 */
export async function createCredentialUser(tx: Tx, input: { name: string; email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw validation({ name: "Informe um nome com até 120 caracteres." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw validation({ email: "E-mail inválido." });
  const hash = await hashPassword(input.password);
  const exists = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) throw new DomainError("CONFLICT", "Já existe um usuário com este e-mail.", { email: "E-mail já cadastrado." });
  const user = await tx.user.create({ data: { name, email, emailVerified: false, active: true }, select: { id: true, email: true, name: true } });
  await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
  return user;
}

/** Troca a senha de um usuário existente e revoga todas as sessões dele. */
export async function setUserPassword(tx: Tx, userId: string, password: string) {
  const hash = await hashPassword(password);
  const acc = await tx.account.findFirst({ where: { userId, providerId: "credential" }, select: { id: true } });
  if (acc) await tx.account.update({ where: { id: acc.id }, data: { password: hash } });
  else await tx.account.create({ data: { userId, accountId: userId, providerId: "credential", password: hash } });
  await tx.session.deleteMany({ where: { userId } });
}
