import { Readable } from "node:stream";
import { openMediaForUser, type Variant } from "@/modules/media/service";
import { errorResponse, unauthenticated } from "@/server/errors";
import { getSessionUser } from "@/server/tenant-context";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download autenticado: sessão + membership no tenant do arquivo. */
export async function GET(req: Request, { params }: RouteContext<"/api/media/[id]">) {
  const requestId = randomUUID();
  try {
    const user = await getSessionUser();
    if (!user) throw unauthenticated();
    const { id } = await params;
    const v = new URL(req.url).searchParams.get("v");
    const variant: Variant = v === "thumb" ? "thumb" : "display";
    const file = await openMediaForUser(user.id, id, variant);
    return new Response(Readable.toWeb(file.stream) as ReadableStream, {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.size),
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
        // Privado: navegador pode guardar, proxies não. Conteúdo é imutável por ID.
        "cache-control": "private, max-age=3600",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
