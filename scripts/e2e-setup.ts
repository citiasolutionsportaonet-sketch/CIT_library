// Prepara o ambiente E2E: banco *_test recriado e migrado, mídia de teste vazia
// e um OWNER de teste com senha aleatória gravada em .env.test (fora do Git).
// Recusa qualquer banco que não termine em _test.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { bootstrapOwner } from "@/modules/tenants/service";
import { dbNameFromUrl, main, requireEnv, run, withDbName } from "./lib/common";

main(async () => {
  const testDb = `${dbNameFromUrl(requireEnv("MIGRATION_DATABASE_URL"))}_test`;
  const port = process.env.E2E_PORT ?? "3100";
  const origin = `http://localhost:${port}`;
  const mediaRoot = path.resolve("var/test-media");
  const env = {
    MIGRATION_DATABASE_URL: withDbName(requireEnv("MIGRATION_DATABASE_URL"), testDb),
    DATABASE_URL: withDbName(requireEnv("DATABASE_URL"), testDb),
    MEDIA_ROOT: mediaRoot,
    BETTER_AUTH_URL: origin,
    APP_ORIGIN: origin,
    TRUSTED_ORIGINS: origin,
    E2E_PORT: port,
  };
  if (!/_test$/.test(dbNameFromUrl(env.DATABASE_URL))) throw new Error("Destino E2E precisa ser *_test.");
  // Recria banco de teste e aplica migrações/grants (mesmo fluxo da integração).
  await run("npx", ["tsx", "-e", `
    const pg=require("pg");(async()=>{const c=new pg.Client({connectionString:${JSON.stringify(withDbName(requireEnv("MIGRATION_DATABASE_URL"), "postgres"))}});
    await c.connect();await c.query('DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)');await c.query('CREATE DATABASE "${testDb}"');await c.end();})()`]);
  await run("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, ...env } });
  await run("npx", ["tsx", "scripts/db-grants.ts"], { env: { ...process.env, ...env } });
  await fs.rm(mediaRoot, { recursive: true, force: true });
  await fs.mkdir(mediaRoot, { recursive: true });

  Object.assign(process.env, env);
  const password = randomBytes(18).toString("base64url");
  const email = "owner-e2e@teste.local";
  await bootstrapOwner({ tenantName: "CIT Teste", tenantSlug: process.env.DEFAULT_TENANT_SLUG || "cit", name: "Owner E2E", email, password });
  const lines = Object.entries({ ...env, E2E_OWNER_EMAIL: email, E2E_OWNER_PASSWORD: password }).map(([k, v]) => `${k}=${v}`);
  await fs.writeFile(".env.test", `# Gerado por scripts/e2e-setup.ts — SOMENTE TESTE, banco ${testDb}\n${lines.join("\n")}\n`, { mode: 0o600 });
  console.log(`✔ Ambiente E2E pronto (${testDb}, ${origin}). Credenciais de teste em .env.test`);
});
