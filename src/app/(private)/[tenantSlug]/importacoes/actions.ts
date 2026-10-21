"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cancelBatch, confirmBatch } from "@/modules/imports/service";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { loadTenantContext } from "@/server/tenant-context";

export async function confirmBatchAction(tenantSlug: string, batchId: string, effectiveDate: string, updateNames: boolean): Promise<ActionResult<{ jobs: number }>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    const r = await confirmBatch(ctx, String(batchId), { effectiveDate: String(effectiveDate), updateNames: Boolean(updateNames) });
    revalidatePath(`/${ctx.tenantSlug}/importacoes/${batchId}`);
    return { ok: true, data: { jobs: r.jobs } };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export async function cancelBatchAction(tenantSlug: string, batchId: string): Promise<ActionResult> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    await cancelBatch(ctx, String(batchId));
    revalidatePath(`/${ctx.tenantSlug}/importacoes/${batchId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}
