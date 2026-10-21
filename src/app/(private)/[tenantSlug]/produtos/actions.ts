"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { reorderMedia, setCover, unlinkMedia, updateAltText } from "@/modules/media/service";
import { createProduct, duplicateProduct, setArchived, updateProduct } from "@/modules/products/service";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { loadTenantContext } from "@/server/tenant-context";

// Cada ação: autenticação + tenant pelo slug + membership (loadTenantContext),
// autorização e validação dentro do serviço. Nenhuma regra fica aqui.

async function run<T>(tenantSlug: string, fn: (ctx: Awaited<ReturnType<typeof loadTenantContext>>) => Promise<T>): Promise<ActionResult<T>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    const data = await fn(ctx);
    return { ok: true, data };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export async function createProductAction(tenantSlug: string, input: unknown) {
  return run(tenantSlug, (ctx) => createProduct(ctx, input));
}

export async function updateProductAction(tenantSlug: string, id: string, version: number, input: unknown) {
  return run(tenantSlug, async (ctx) => {
    const r = await updateProduct(ctx, String(id), Number(version), input);
    revalidatePath(`/${ctx.tenantSlug}/produtos/${id}`);
    return r;
  });
}

export async function archiveProductAction(tenantSlug: string, id: string, version: number, archived: boolean) {
  return run(tenantSlug, (ctx) => setArchived(ctx, String(id), Number(version), Boolean(archived)));
}

export async function duplicateProductAction(tenantSlug: string, id: string, newSku: string) {
  return run(tenantSlug, (ctx) => duplicateProduct(ctx, String(id), String(newSku)));
}

export async function reorderMediaAction(tenantSlug: string, productId: string, ids: string[]) {
  return run(tenantSlug, (ctx) => reorderMedia(ctx, String(productId), Array.isArray(ids) ? ids.map(String).slice(0, 100) : []));
}

export async function setCoverAction(tenantSlug: string, productId: string, mediaId: string) {
  return run(tenantSlug, (ctx) => setCover(ctx, String(productId), String(mediaId)));
}

export async function updateAltTextAction(tenantSlug: string, productId: string, mediaId: string, alt: string) {
  return run(tenantSlug, (ctx) => updateAltText(ctx, String(productId), String(mediaId), String(alt)));
}

export async function unlinkMediaAction(tenantSlug: string, productId: string, mediaId: string) {
  return run(tenantSlug, (ctx) => unlinkMedia(ctx, String(productId), String(mediaId)));
}
