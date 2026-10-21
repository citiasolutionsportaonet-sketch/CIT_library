import "server-only";
import type { Job, JobType, Prisma } from "@/generated/prisma/client";
import { getDb, type Tx } from "../db";

export const LEASE_SECONDS = 90;

export type EnqueueInput = {
  tenantId: string;
  type: JobType;
  actorId: string;
  runId?: string | null;
  productId?: string | null;
  batchId?: string | null;
  payload?: Prisma.InputJsonValue;
  maxAttempts?: number;
};

export async function enqueueMany(jobs: EnqueueInput[], tx: Tx = getDb()) {
  if (jobs.length === 0) return 0;
  const r = await tx.job.createMany({
    data: jobs.map((j) => ({
      tenantId: j.tenantId,
      type: j.type,
      actorId: j.actorId,
      runId: j.runId ?? null,
      productId: j.productId ?? null,
      batchId: j.batchId ?? null,
      payload: j.payload ?? {},
      maxAttempts: j.maxAttempts ?? 3,
    })),
  });
  return r.count;
}

/**
 * Reserva atomicamente o próximo job elegível. Jobs de execuções pausadas ou
 * canceladas não são reservados. Vários workers podem rodar em paralelo.
 */
export async function claimNext(workerId: string): Promise<Job | null> {
  const rows = await getDb().$queryRaw<Job[]>`
    UPDATE "job" SET "status" = 'RUNNING', "lockedBy" = ${workerId}, "attempts" = "attempts" + 1,
      "leaseUntil" = now() + make_interval(secs => ${LEASE_SECONDS}), "heartbeatAt" = now(),
      "startedAt" = COALESCE("startedAt", now())
    WHERE "id" = (
      SELECT j."id" FROM "job" j
      LEFT JOIN "research_run" r ON r."id" = j."runId"
      WHERE j."status" = 'QUEUED' AND j."runAfter" <= now()
        AND (j."runId" IS NULL OR r."status" = 'RUNNING')
      ORDER BY j."runAfter", j."createdAt", j."id"
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export async function heartbeat(jobId: string, workerId: string): Promise<boolean> {
  const n = await getDb().$executeRaw`
    UPDATE "job" SET "heartbeatAt" = now(), "leaseUntil" = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE "id" = ${jobId}::uuid AND "lockedBy" = ${workerId} AND "status" = 'RUNNING'`;
  return n === 1;
}

export async function completeJob(jobId: string, workerId: string, result: Prisma.InputJsonValue = {}) {
  await getDb().job.updateMany({
    where: { id: jobId, lockedBy: workerId, status: "RUNNING" },
    data: { status: "SUCCEEDED", result, finishedAt: new Date(), leaseUntil: null, lastError: null },
  });
}

/** Falha: nova tentativa com espera exponencial ou FAILED ao esgotar. */
export async function failJob(job: Job, workerId: string, message: string, opts: { retryable?: boolean; delaySeconds?: number } = {}) {
  const retry = (opts.retryable ?? true) && job.attempts < job.maxAttempts;
  const delay = opts.delaySeconds ?? Math.min(3600, 30 * 2 ** (job.attempts - 1));
  await getDb().job.updateMany({
    where: { id: job.id, lockedBy: workerId, status: "RUNNING" },
    data: retry
      ? { status: "QUEUED", runAfter: new Date(Date.now() + delay * 1000), lockedBy: null, leaseUntil: null, lastError: message.slice(0, 1000) }
      : { status: "FAILED", finishedAt: new Date(), leaseUntil: null, lastError: message.slice(0, 1000) },
  });
}

/** Devolve sem consumir tentativa (ex.: limite de provedor, execução pausada). */
export async function deferJob(job: Job, workerId: string, seconds: number, note: string) {
  await getDb().job.updateMany({
    where: { id: job.id, lockedBy: workerId, status: "RUNNING" },
    data: { status: "QUEUED", attempts: { decrement: 1 }, runAfter: new Date(Date.now() + seconds * 1000), lockedBy: null, leaseUntil: null, lastError: note.slice(0, 1000) },
  });
}

/** Jobs com lease vencida (worker morreu) voltam para a fila ou falham. */
export async function recoverExpired(): Promise<number> {
  return getDb().$executeRaw`
    UPDATE "job" SET
      "status" = CASE WHEN "attempts" >= "maxAttempts" THEN 'FAILED'::"JobStatus" ELSE 'QUEUED'::"JobStatus" END,
      "lockedBy" = NULL, "leaseUntil" = NULL,
      "finishedAt" = CASE WHEN "attempts" >= "maxAttempts" THEN now() ELSE NULL END,
      "lastError" = 'Lease expirada (worker interrompido); job recuperado.'
    WHERE "status" = 'RUNNING' AND "leaseUntil" < now()`;
}
