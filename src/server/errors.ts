import "server-only";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "MAINTENANCE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

export type FieldErrors = Record<string, string>;

export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields: FieldErrors = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Recurso") => new DomainError("NOT_FOUND", `${what} não encontrado.`);
export const forbidden = () => new DomainError("FORBIDDEN", "Você não tem permissão para esta operação.");
export const unauthenticated = () => new DomainError("UNAUTHENTICATED", "Sessão expirada. Entre novamente.");
export const validation = (fields: FieldErrors, message = "Revise os campos destacados.") =>
  new DomainError("VALIDATION", message, fields);

/** Resultado serializável para Server Actions e respostas JSON. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; fields: FieldErrors; requestId: string };

/** Converte qualquer erro em resposta segura (sem stack, SQL ou caminhos). */
export function toErrorResult(err: unknown, requestId: string): Extract<ActionResult, { ok: false }> {
  if (err instanceof DomainError) {
    return { ok: false, code: err.code, message: err.message, fields: err.fields, requestId };
  }
  logError(err, requestId);
  return {
    ok: false,
    code: "INTERNAL",
    message: "Erro inesperado. Tente novamente; se persistir, informe o código da requisição.",
    fields: {},
    requestId,
  };
}

export function errorResponse(err: unknown, requestId: string): Response {
  const body = toErrorResult(err, requestId);
  const status = err instanceof DomainError ? err.status : 500;
  return Response.json(
    { error: { code: body.code, message: body.message, fields: body.fields, requestId } },
    { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

export function logError(err: unknown, requestId: string, extra: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  // Log estruturado no servidor; nunca é enviado ao navegador.
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      name: e.name,
      message: e.message,
      stack: e.stack?.split("\n").slice(0, 6).join(" | "),
      ...extra,
    }),
  );
}

/** Detecta violação de unicidade do Prisma/PostgreSQL e retorna os campos. */
export function uniqueViolationTarget(err: unknown): string[] | null {
  const anyErr = err as { code?: string; meta?: Record<string, unknown>; cause?: unknown };
  if (anyErr?.code === "P2002") {
    const meta = anyErr.meta ?? {};
    // Prisma 7 + adapter-pg informa o nome do índice; outros caminhos, os campos.
    const constraint = (meta.driverAdapterError as { cause?: { constraint?: { fields?: string[]; index?: string } } })?.cause?.constraint;
    const target = meta.target ?? constraint?.fields ?? constraint?.index;
    if (Array.isArray(target)) return target.map(String);
    if (typeof target === "string") return [target];
    return [];
  }
  return null;
}
