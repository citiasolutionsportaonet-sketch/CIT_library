"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  acceptSuggestion,
  applyBrandProposals,
  applyCategoryProposals,
  type BulkChange,
  bulkUpdate,
  deleteTaxonomy,
  fillSuggestedModels,
  saveBrand,
  saveCategory,
  setTaxonomyActive,
} from "@/modules/catalog/service";
import type { ListParams } from "@/modules/products/service";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { loadTenantContext, type TenantContext } from "@/server/tenant-context";

async function run<T>(tenantSlug: string, fn: (ctx: TenantContext) => Promise<T>): Promise<ActionResult<T>> {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext(String(tenantSlug));
    requestId = ctx.requestId;
    const data = await fn(ctx);
    revalidatePath(`/${ctx.tenantSlug}`, "layout");
    return { ok: true, data };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}

export const applyCategoriesAction = async (s: string, paths: string[]) => run(s, (ctx) => applyCategoryProposals(ctx, Array.isArray(paths) ? paths.slice(0, 200) : []));
export const applyBrandsAction = async (s: string, brands: string[]) => run(s, (ctx) => applyBrandProposals(ctx, Array.isArray(brands) ? brands.slice(0, 50) : []));
export const fillModelsAction = async (s: string) => run(s, (ctx) => fillSuggestedModels(ctx));
export const saveCategoryAction = async (s: string, input: { id?: string; name: string; parentId?: string | null }) => run(s, (ctx) => saveCategory(ctx, input));
export const saveBrandAction = async (s: string, input: { id?: string; name: string }) => run(s, (ctx) => saveBrand(ctx, input));
export const setActiveAction = async (s: string, kind: "brand" | "category", id: string, active: boolean) => run(s, (ctx) => setTaxonomyActive(ctx, kind === "brand" ? "brand" : "category", String(id), Boolean(active)));
export const deleteTaxonomyAction = async (s: string, kind: "brand" | "category" | "tag", id: string) => run(s, (ctx) => deleteTaxonomy(ctx, (["brand", "category", "tag"] as const).find((k) => k === kind) ?? "tag", String(id)));
export const acceptSuggestionAction = async (s: string, productId: string, field: "model" | "manufacturer") => run(s, (ctx) => acceptSuggestion(ctx, String(productId), field === "model" ? "model" : "manufacturer"));
export const bulkUpdateAction = async (s: string, filter: ListParams, change: BulkChange, expected: number) => run(s, (ctx) => bulkUpdate(ctx, filter, change, Number(expected)));
