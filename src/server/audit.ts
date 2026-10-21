import "server-only";
import type { Tx } from "./db";

const SENSITIVE = /pass(word)?|token|secret|hash|cookie|session/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[...]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[redigido]" : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export type AuditInput = {
  tenantId: string;
  actorId: string | null;
  requestId: string;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, unknown>;
};

/** Registra evento na mesma transação da mudança (append-only). */
export async function audit(tx: Tx, e: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: e.tenantId,
      actorId: e.actorId,
      requestId: e.requestId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      sanitizedDiff: (sanitize(e.diff ?? {}) ?? {}) as object,
    },
  });
}

/** Diferença rasa entre dois objetos, somente campos permitidos. */
export function shallowDiff(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]) {
  const diff: Record<string, { de: unknown; para: unknown }> = {};
  for (const f of fields) {
    const a = JSON.stringify(before[f] ?? null);
    const b = JSON.stringify(after[f] ?? null);
    if (a !== b) diff[f] = { de: before[f] ?? null, para: after[f] ?? null };
  }
  return diff;
}
