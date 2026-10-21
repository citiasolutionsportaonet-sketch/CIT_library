import { apiProductPrices } from "@/modules/api/catalog";
import { requireScope } from "@/modules/api/credentials";
import { apiRoute } from "@/modules/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiRoute(async (p, _req, { params }: RouteContext<"/api/v1/products/[id]/prices">) => {
  requireScope(p, "prices:read");
  return apiProductPrices(p, (await params).id);
});
