import "server-only";
import type { Role } from "@/generated/prisma/enums";

export type Capability =
  | "catalog:read"
  | "prices:read"
  | "products:write"
  | "prices:write"
  | "imports:write"
  | "members:manage"
  | "owner:manage"
  | "audit:read"
  | "backup:run"
  | "costs:read"
  | "pricing:configure"
  | "research:review"
  | "research:run"
  | "api:manage";

// Matriz da seção 7 do CLAUDE.md. Fonte única de verdade no servidor.
// research:run dispara pesquisa com custo de API (OWNER/ADMIN); api:manage
// cria credenciais externas (somente OWNER); VIEWER nunca vê custos.
const MATRIX: Record<Role, readonly Capability[]> = {
  OWNER: ["catalog:read", "prices:read", "costs:read", "products:write", "prices:write", "imports:write", "research:review", "research:run", "pricing:configure", "members:manage", "owner:manage", "api:manage", "audit:read", "backup:run"],
  ADMIN: ["catalog:read", "prices:read", "costs:read", "products:write", "prices:write", "imports:write", "research:review", "research:run", "pricing:configure", "members:manage", "audit:read", "backup:run"],
  EDITOR: ["catalog:read", "prices:read", "costs:read", "products:write", "prices:write", "imports:write", "research:review"],
  VIEWER: ["catalog:read"],
};

export function permissionsFor(role: Role): ReadonlySet<Capability> {
  return new Set(MATRIX[role]);
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  EDITOR: "Editor",
  VIEWER: "Leitor",
};

/** Papéis que `actor` pode atribuir ou alterar. ADMIN não toca OWNER. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target !== "OWNER";
  return false;
}
