import "server-only";
import { getDb } from "./db";

export type ConsumeResult = { allowed: boolean; retryAfter: number | null };

/**
 * Janela fixa persistente no PostgreSQL. Verificação e incremento acontecem
 * em um único UPSERT atômico, válido com vários processos do aplicativo.
 */
export async function consumeRateLimit(key: string, windowSeconds: number, max: number): Promise<ConsumeResult> {
  const rows = await getDb().$queryRaw<{ count: number; retry: number }[]>`
    INSERT INTO "rate_limit_bucket" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_bucket"."windowStart" <= now() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE "rate_limit_bucket"."count" + 1 END,
      "windowStart" = CASE WHEN "rate_limit_bucket"."windowStart" <= now() - make_interval(secs => ${windowSeconds})
                     THEN now() ELSE "rate_limit_bucket"."windowStart" END
    RETURNING "count",
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${windowSeconds}) - now()))))::int AS "retry"`;
  const row = rows[0];
  const allowed = row.count <= max;
  return { allowed, retryAfter: allowed ? null : Math.max(1, row.retry) };
}

/** Remove janelas antigas; chamado ocasionalmente. */
export async function pruneRateLimits(olderThanSeconds = 86400) {
  await getDb().$executeRaw`DELETE FROM "rate_limit_bucket" WHERE "windowStart" < now() - make_interval(secs => ${olderThanSeconds})`;
}
