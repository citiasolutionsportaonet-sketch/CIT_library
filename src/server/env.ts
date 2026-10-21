import "server-only";
import path from "node:path";
import { z } from "zod";

// Validação lazy: o build do Next importa módulos sem .env de produção.
const PLACEHOLDER = /SUBSTITUIR|SENHA_URL_ENCODED/;

const schema = z.object({
  DATABASE_URL: z.string().url().refine((v) => !PLACEHOLDER.test(v), "contém placeholder"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "use pelo menos 32 caracteres (openssl rand -hex 32)")
    .refine((v) => !PLACEHOLDER.test(v), "contém placeholder"),
  BETTER_AUTH_URL: z.string().url(),
  APP_ORIGIN: z.string().url(),
  TRUSTED_ORIGINS: z.string().default(""),
  MEDIA_ROOT: z.string().min(1),
  BACKUP_ROOT: z.string().min(1).default("./var/backups"),
  DEFAULT_TENANT_SLUG: z.string().default("cit"),
  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MEDIA_MAX_PER_PRODUCT: z.coerce.number().int().positive().default(20),
  MEDIA_TENANT_QUOTA_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024 * 1024),
});

export type AppEnv = z.infer<typeof schema> & {
  mediaRootAbs: string;
  backupRootAbs: string;
  trustedOrigins: string[];
  secureCookies: boolean;
};

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuração incompleta no .env -> ${fields.join("; ")}`);
  }
  const e = parsed.data;
  const origins = new Set(
    [e.APP_ORIGIN, e.BETTER_AUTH_URL, ...e.TRUSTED_ORIGINS.split(",")]
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => new URL(s).origin),
  );
  cached = {
    ...e,
    mediaRootAbs: path.resolve(/*turbopackIgnore: true*/ process.cwd(), e.MEDIA_ROOT),
    backupRootAbs: path.resolve(/*turbopackIgnore: true*/ process.cwd(), e.BACKUP_ROOT),
    trustedOrigins: [...origins],
    secureCookies: new URL(e.BETTER_AUTH_URL).protocol === "https:",
  };
  return cached;
}
