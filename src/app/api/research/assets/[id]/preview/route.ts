import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { IMAGE_ACCEPT, politeFetch } from "@/modules/research/http";
import { getDb } from "@/server/db";
import { errorResponse, forbidden, notFound, unauthenticated } from "@/server/errors";
import { permissionsFor } from "@/server/permissions";
import { getSessionUser } from "@/server/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Miniatura de imagem CANDIDATA para revisão: o servidor busca (com proteção
 * SSRF e robots), reencoda e serve. O navegador nunca acessa o site externo.
 */
export async function GET(_req: Request, { params }: RouteContext<"/api/research/assets/[id]/preview">) {
  const requestId = randomUUID();
  try {
    const user = await getSessionUser();
    if (!user) throw unauthenticated();
    const { id } = await params;
    if (!UUID.test(id)) throw notFound("Imagem");
    const a = await getDb().researchAsset.findFirst({ where: { id, kind: "IMAGE" }, select: { tenantId: true, url: true } });
    if (!a) throw notFound("Imagem");
    const m = await getDb().membership.findFirst({ where: { userId: user.id, tenantId: a.tenantId, active: true }, select: { role: true } });
    if (!m) throw notFound("Imagem");
    if (!permissionsFor(m.role).has("research:review")) throw forbidden();
    const res = await politeFetch(a.url, { maxBytes: 10 * 1024 * 1024, accept: IMAGE_ACCEPT });
    if (res.status !== 200) throw notFound("Imagem");
    const out = await sharp(res.body, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize(360, 360, { fit: "inside" }).webp({ quality: 70 }).toBuffer();
    return new Response(new Uint8Array(out), { headers: { "content-type": "image/webp", "x-content-type-options": "nosniff", "cache-control": "private, max-age=600" } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
