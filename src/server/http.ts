import "server-only";
import { getEnv } from "./env";
import { DomainError } from "./errors";

/**
 * Mutações via Route Handler exigem Origin de lista exata (além do cookie
 * SameSite=Lax). Server Actions já têm checagem de origem do próprio Next.
 */
export function assertTrustedOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const allowed = getEnv().trustedOrigins;
  if (!origin || !allowed.includes(origin)) {
    throw new DomainError("FORBIDDEN", "Origem da requisição não permitida.");
  }
}
