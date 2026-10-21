import "server-only";
import { randomUUID } from "node:crypto";
import { errorResponse } from "@/server/errors";
import { type ApiPrincipal, authenticateApi, requireScope } from "./credentials";

/** Envelope padrão das rotas /api/v1: autenticação, escopo, erros e requestId. */
export function apiRoute<C>(fn: (p: ApiPrincipal, req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    const requestId = randomUUID();
    try {
      const p = await authenticateApi(req, requestId);
      requireScope(p, "catalog:read");
      const body = await fn(p, req, ctx);
      if (body instanceof Response) return body;
      return Response.json(body, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}
