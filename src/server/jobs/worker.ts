import "server-only";
import { hostname } from "node:os";
import type { Job } from "@/generated/prisma/client";
import { applyImportChunk, finishBatchIfDone } from "@/modules/imports/service";
import { BudgetExhausted, researchProductJob, RunNotRunning } from "@/modules/research/engine";
import { FetchBlocked } from "@/modules/research/http";
import { finishRunIfDone } from "@/modules/research/service";
import { getDb } from "../db";
import { DomainError, logError } from "../errors";
import { claimNext, completeJob, deferJob, failJob, heartbeat, recoverExpired } from "./queue";

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level: "info", msg, ...extra }));

async function handle(job: Job, workerId: string) {
  const hb = setInterval(() => void heartbeat(job.id, workerId).catch(() => {}), 20_000);
  const started = Date.now();
  try {
    if (job.type === "IMPORT_APPLY") {
      const r = await applyImportChunk(job);
      await completeJob(job.id, workerId, r);
      log("job.ok", { job: job.id, type: job.type, ms: Date.now() - started, ...r });
    } else {
      const r = await researchProductJob(job);
      await completeJob(job.id, workerId, r);
      log("job.ok", { job: job.id, type: job.type, product: job.productId, ms: Date.now() - started, images: r.images, docs: r.documents, offers: r.offers, paidCalls: r.paidCalls });
    }
  } catch (err) {
    const e = err as Error & { retryAfter?: number; retryable?: boolean };
    if (err instanceof RunNotRunning || err instanceof BudgetExhausted) {
      // Volta para a fila sem gastar tentativa; só roda quando a execução for retomada.
      await deferJob(job, workerId, 30, e.message);
      await getDb().product.updateMany({ where: { id: job.productId ?? undefined, researchStatus: "IN_PROGRESS" }, data: { researchStatus: "QUEUED" } });
      log("job.deferred", { job: job.id, reason: e.message });
    } else if (e.retryAfter || (err instanceof FetchBlocked && err.reason === "rate")) {
      await deferJob(job, workerId, e.retryAfter ?? 60, e.message);
      log("job.rate_limited", { job: job.id, reason: e.message });
    } else {
      const permanent = e.retryable === false || (err instanceof DomainError && ["FORBIDDEN", "NOT_FOUND", "VALIDATION"].includes(err.code));
      await failJob(job, workerId, e.message, { retryable: !permanent });
      if (job.type === "RESEARCH_PRODUCT" && job.productId) {
        const j = await getDb().job.findUnique({ where: { id: job.id }, select: { status: true } });
        await getDb().product.updateMany({ where: { id: job.productId }, data: { researchStatus: j?.status === "FAILED" ? "FAILED" : "QUEUED" } });
      }
      logError(err, `job:${job.id}`, { type: job.type });
    }
  } finally {
    clearInterval(hb);
    if (job.batchId) await finishBatchIfDone(job.tenantId, job.batchId, job.actorId, `job:${job.id}`).catch((e) => logError(e, `job:${job.id}`));
    if (job.runId) await finishRunIfDone(job.runId).catch((e) => logError(e, `job:${job.id}`));
  }
}

/** Loop principal. Concorrência limitada; encerra limpo em SIGINT/SIGTERM. */
export async function runWorker(opts: { concurrency?: number; pollMs?: number; once?: boolean } = {}) {
  const concurrency = opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 2);
  const workerId = `${hostname()}:${process.pid}`;
  let stopping = false;
  const stop = () => {
    if (!stopping) log("worker.stopping");
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log("worker.start", { workerId, concurrency });
  let lastRecover = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (!stopping) {
      if (Date.now() - lastRecover > 30_000) {
        lastRecover = Date.now();
        const n = await recoverExpired().catch(() => 0);
        if (n) log("worker.recovered", { jobs: n });
      }
      const job = await claimNext(workerId).catch((e) => (logError(e, "worker.claim"), null));
      if (!job) {
        if (opts.once) return;
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
        continue;
      }
      await handle(job, workerId);
    }
  });
  await Promise.all(lanes);
  log("worker.stopped");
}
