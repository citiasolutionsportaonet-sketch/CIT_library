import { randomUUID } from "node:crypto";
import type { ProductStatus, ResearchStatus } from "@/generated/prisma/enums";
import { exportProductsCsv } from "@/modules/catalog/export";
import { errorResponse } from "@/server/errors";
import { loadTenantContext } from "@/server/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download autenticado do catálogo filtrado (mesmos parâmetros da tela). */
export async function GET(req: Request, { params }: RouteContext<"/api/t/[tenantSlug]/export/produtos">) {
  let requestId: string = randomUUID();
  try {
    const ctx = await loadTenantContext((await params).tenantSlug);
    requestId = ctx.requestId;
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");
    const { csv, rows } = await exportProductsCsv(ctx, {
      q: sp.get("q") ?? undefined,
      brandId: sp.get("marca") ?? undefined,
      categoryId: sp.get("categoria") ?? undefined,
      tagId: sp.get("tag") ?? undefined,
      status: (["DRAFT", "ACTIVE", "ARCHIVED", "ALL"] as const).find((s) => s === status) as ProductStatus | "ALL" | undefined,
      researchStatus: (sp.get("pesquisa") || undefined) as ResearchStatus | undefined,
    });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="cit-produtos-${day}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
        "x-rows": String(rows),
      },
    });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
