"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { bulkApproveOfficialImages, controlRun, createRun } from "@/modules/research/service";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { loadTenantContext } from "@/server/tenant-context";

export async function createRunAction(tenantSlug: string, input: { name: string; limit: number; providers: string[]; maxApiCalls: number; maxCostReais: string; onlyPending: boolean; onlyWithCost: boolean; autoApproveOfficialImages: boolean }): Promise<ActionResult<{ id: string; jobs: number }>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    const cents = Math.round(Number(String(input.maxCostReais).replace(/\./g, "").replace(",", ".")) * 100);
    const run = await createRun(ctx, {
      name: input.name,
      limit: input.limit,
      providers: input.providers,
      maxApiCalls: input.maxApiCalls,
      maxCostCents: Number.isFinite(cents) ? cents : -1,
      autoApproveOfficialImages: Boolean(input.autoApproveOfficialImages),
      filter: { researchStatus: input.onlyPending ? ["PENDING", "FAILED", "NO_DATA"] : undefined, onlyWithCost: input.onlyWithCost },
    });
    revalidatePath(`/${ctx.tenantSlug}/pesquisa`);
    return { ok: true, data: { id: run.id, jobs: run.totalJobs } };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export async function controlRunAction(tenantSlug: string, runId: string, action: "pause" | "resume" | "cancel" | "retry-failed"): Promise<ActionResult<{ changed: number }>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    if (!["pause", "resume", "cancel", "retry-failed"].includes(action)) throw new Error("ação inválida");
    const r = await controlRun(ctx, String(runId), action);
    revalidatePath(`/${ctx.tenantSlug}/pesquisa`);
    return { ok: true, data: r };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export async function approveOfficialImagesAction(tenantSlug: string): Promise<ActionResult<{ products: number; approved: number; notes: string[] }>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    const r = await bulkApproveOfficialImages(ctx);
    revalidatePath(`/${ctx.tenantSlug}`, "layout");
    return { ok: true, data: r };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}
