import { randomUUID } from "node:crypto";
import { createImportBatch } from "@/modules/imports/service";
import { XLSX_LIMITS } from "@/modules/imports/xlsx";
import { DomainError, errorResponse } from "@/server/errors";
import { assertTrustedOrigin } from "@/server/http";
import { loadTenantContext } from "@/server/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Envio de planilha (corpo binário). Gera prévia; nada é aplicado ao catálogo. */
export async function POST(req: Request, { params }: RouteContext<"/api/t/[tenantSlug]/imports">) {
  let requestId: string = randomUUID();
  try {
    assertTrustedOrigin(req);
    const ctx = await loadTenantContext((await params).tenantSlug);
    requestId = ctx.requestId;
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > XLSX_LIMITS.maxFileBytes) throw new DomainError("PAYLOAD_TOO_LARGE", "Arquivo acima de 20 MB.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const c of req.body as unknown as AsyncIterable<Uint8Array>) {
      total += c.length;
      if (total > XLSX_LIMITS.maxFileBytes) throw new DomainError("PAYLOAD_TOO_LARGE", "Arquivo acima de 20 MB.");
      chunks.push(c);
    }
    const bytes = new Uint8Array(Buffer.concat(chunks));
    const dec = (h: string) => {
      try {
        return decodeURIComponent(req.headers.get(h) ?? "");
      } catch {
        return "";
      }
    };
    const r = await createImportBatch(ctx, { bytes, fileName: dec("x-file-name") || "planilha.xlsx", supplier: dec("x-supplier"), justification: dec("x-justification") || undefined });
    return Response.json({ data: r }, { status: 201, headers: { "x-request-id": requestId } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
