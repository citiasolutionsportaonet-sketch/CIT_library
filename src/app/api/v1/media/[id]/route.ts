import { Readable } from "node:stream";
import { apiRoute } from "@/modules/api/handler";
import { getDb } from "@/server/db";
import { notFound } from "@/server/errors";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Imagem aprovada, somente do tenant da credencial. */
export const GET = apiRoute(async (p, req, { params }: RouteContext<"/api/v1/media/[id]">) => {
  const { id } = await params;
  if (!UUID.test(id)) throw notFound("Arquivo");
  const asset = await getDb().mediaAsset.findFirst({ where: { id, tenantId: p.tenantId, state: "READY", products: { some: {} } }, select: { storageKey: true } });
  if (!asset) throw notFound("Arquivo");
  const v = new URL(req.url).searchParams.get("v") === "thumb" ? "thumb" : "display";
  const storage = await getStorage();
  const key = `${asset.storageKey}/${v}.webp`;
  const st = await storage.stat(key);
  if (!st) throw notFound("Arquivo");
  return new Response(Readable.toWeb(await storage.get(key)) as ReadableStream, {
    headers: { "content-type": "image/webp", "content-length": String(st.size), "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600" },
  });
});
