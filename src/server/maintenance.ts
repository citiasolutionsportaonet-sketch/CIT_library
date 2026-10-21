import "server-only";
import { getDb, type Tx } from "./db";
import { DomainError } from "./errors";

/**
 * Chave do advisory lock de escrita. Toda mutação toma o lock compartilhado
 * dentro da transação; o backup toma o lock exclusivo (scripts/backup.ts),
 * esperando as transações em curso e fazendo novas falharem com 503.
 */
export const WRITE_LOCK_KEY = 7_310_001;

export async function acquireWriteLock(tx: Tx): Promise<void> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock_shared(${WRITE_LOCK_KEY}::bigint) AS ok`;
  if (!rows[0]?.ok) {
    throw new DomainError("MAINTENANCE", "Sistema em manutenção (backup em andamento). Tente novamente em alguns minutos.");
  }
}

/** Transação de escrita padrão: lock de manutenção + função de domínio. */
export function writeTx<T>(fn: (tx: Tx) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  return getDb().$transaction(
    async (tx) => {
      await acquireWriteLock(tx);
      return fn(tx);
    },
    { timeout: opts.timeout ?? 15_000, maxWait: 10_000 },
  );
}
