import { apiGetProduct } from "@/modules/api/catalog";
import { apiRoute } from "@/modules/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async (p, _req, { params }: RouteContext<"/api/v1/products/[id]">) => apiGetProduct(p, (await params).id));
