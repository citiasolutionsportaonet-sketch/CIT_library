// Testes de integração contra PostgreSQL REAL em banco isolado *_test.
// Recria o banco, aplica migrações e grants, e roda Vitest (projeto integration).
// Recusa qualquer destino que não termine em "_test".
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { dbNameFromUrl, main, requireEnv, run, withDbName } from "./lib/common";

main(async () => {
  const ownerUrl = requireEnv("MIGRATION_DATABASE_URL");
  const appUrl = requireEnv("DATABASE_URL");
  const testDb = process.env.TEST_DATABASE_NAME || `${dbNameFromUrl(ownerUrl)}_test`;
  if (!/^[a-z][a-z0-9_]*_test$/.test(testDb)) throw new Error(`Banco de teste precisa terminar em _test (recebido: ${testDb}).`);
  if (testDb === dbNameFromUrl(ownerUrl)) throw new Error("Banco de teste não pode ser o banco em uso.");

  const admin = new pg.Client({ connectionString: withDbName(ownerUrl, "postgres") });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDb}"`);
  } finally {
    await admin.end();
  }
  const testOwner = withDbName(ownerUrl, testDb);
  const testApp = withDbName(appUrl, testDb);
  const mediaRoot = path.resolve("var/test-media");
  await fs.rm(mediaRoot, { recursive: true, force: true });
  await fs.mkdir(mediaRoot, { recursive: true });

  const env = { ...process.env, MIGRATION_DATABASE_URL: testOwner, DATABASE_URL: testApp, MEDIA_ROOT: mediaRoot, CIT_TEST: "1" };
  await run("npx", ["prisma", "migrate", "deploy"], { env });
  await run("npx", ["tsx", "scripts/db-grants.ts"], { env });
  await run("npx", ["vitest", "run", "--project", "integration"], { env });
});
