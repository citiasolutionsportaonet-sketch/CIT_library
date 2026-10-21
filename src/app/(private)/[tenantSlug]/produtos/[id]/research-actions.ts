"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { approveAsset, rejectAsset, reviewOffer } from "@/modules/research/service";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { loadTenantContext } from "@/server/tenant-context";

async function run(tenantSlug: string, productId: string, fn: (ctx: Awaited<ReturnType<typeof loadTenantContext>>) => Promise<void>): Promise<ActionResult> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    await fn(ctx);
    revalidatePath(`/${ctx.tenantSlug}/produtos/${productId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export async function reviewOfferAction(tenantSlug: string, productId: string, offerId: string, decision: "ACCEPTED" | "REJECTED") {
  return run(tenantSlug, productId, (ctx) => reviewOffer(ctx, String(offerId), decision === "ACCEPTED" ? "ACCEPTED" : "REJECTED"));
}

export async function approveAssetAction(tenantSlug: string, productId: string, assetId: string) {
  return run(tenantSlug, productId, (ctx) => approveAsset(ctx, String(assetId)));
}

export async function rejectAssetAction(tenantSlug: string, productId: string, assetId: string) {
  return run(tenantSlug, productId, (ctx) => rejectAsset(ctx, String(assetId)));
}
