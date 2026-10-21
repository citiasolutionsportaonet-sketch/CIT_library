import { uploadProductImage } from "@/modules/media/service";
import { errorResponse } from "@/server/errors";
import { assertTrustedOrigin } from "@/server/http";
import { loadTenantContext } from "@/server/tenant-context";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload de uma foto por requisição. Corpo = bytes do arquivo (permite
 * progresso no cliente). Nome original vem no header X-File-Name (URL-encoded)
 * e serve só como metadado; o tipo é detectado pelo conteúdo.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/t/[tenantSlug]/products/[productId]/media">) {
  let requestId: string = randomUUID();
  try {
    assertTrustedOrigin(req);
    const { tenantSlug, productId } = await params;
    const ctx = await loadTenantContext(tenantSlug);
    requestId = ctx.requestId;
    let name = "imagem";
    try {
      name = decodeURIComponent(req.headers.get("x-file-name") ?? "imagem");
    } catch {
      /* nome inválido: usa padrão */
    }
    const len = req.headers.get("content-length");
    const result = await uploadProductImage(ctx, productId, req.body, name, len ? Number(len) : null);
    return Response.json({ data: result }, { status: 201, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
