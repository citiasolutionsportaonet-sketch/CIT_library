import { apiListProducts } from "@/modules/api/catalog";
import { apiRoute } from "@/modules/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute((p, req) => apiListProducts(p, new URL(req.url)));
