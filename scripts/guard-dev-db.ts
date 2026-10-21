// Impede `prisma migrate dev` em banco de operação.
import { fail, requireEnv } from "./lib/common";

const url = new URL(requireEnv("MIGRATION_DATABASE_URL"));
if (process.env.CIT_ENV === "production") fail("CIT_ENV=production: use npm run db:deploy, nunca migrate dev.");
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) fail("migrate dev só é permitido em banco local de desenvolvimento.");
