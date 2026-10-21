// Cria/atualiza o papel restrito do aplicativo e aplica privilégios mínimos.
// Idempotente; executado ao final de `npm run db:deploy`.
//   - cit_app: SELECT/INSERT/UPDATE/DELETE nas tabelas de domínio, sem DDL.
//   - audit_event e price_entry: somente SELECT/INSERT (append-only).
//   - market_offer, research_asset, import_*: sem DELETE.
//   - _prisma_migrations: sem acesso.
import pg from "pg";
import { dbNameFromUrl, main, requireEnv } from "./lib/common";

main(async () => {
  const ownerUrl = process.env.GRANTS_DATABASE_URL ?? requireEnv("MIGRATION_DATABASE_URL");
  const appUrl = new URL(process.env.GRANTS_APP_DATABASE_URL ?? requireEnv("DATABASE_URL"));
  const appRole = decodeURIComponent(appUrl.username);
  const appPassword = requireEnv("APP_DB_PASSWORD");
  if (decodeURIComponent(appUrl.password) !== appPassword) throw new Error("APP_DB_PASSWORD difere da senha em DATABASE_URL.");
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(appRole)) throw new Error("Nome de papel inválido em DATABASE_URL.");
  if (appRole === decodeURIComponent(new URL(ownerUrl).username)) {
    console.warn("⚠ DATABASE_URL usa o mesmo usuário das migrações; nenhum papel restrito aplicado.");
    return;
  }
  const db = dbNameFromUrl(ownerUrl);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
    // Senha via literal escapado pelo driver (format não aceita parâmetro em DDL).
    const pwLiteral = client.escapeLiteral(appPassword);
    if (exists.rowCount === 0) {
      await client.query(`CREATE ROLE ${ident(appRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${pwLiteral}`);
      console.log(`✔ papel ${appRole} criado`);
    } else {
      await client.query(`ALTER ROLE ${ident(appRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pwLiteral}`);
    }
    await client.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(appRole)}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(appRole)}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(appRole)}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(appRole)}`);
    await client.query(`REVOKE ALL ON TABLE "_prisma_migrations" FROM ${ident(appRole)}`);
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_event" FROM ${ident(appRole)}`);
    // Histórico de preços é append-only; cotações/evidências só mudam de status.
    const has = async (t: string) => (await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${t}`])).rows[0].ok;
    if (await has("price_entry")) await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "price_entry" FROM ${ident(appRole)}`);
    for (const t of ["market_offer", "research_asset", "import_row", "import_batch"]) {
      if (await has(t)) await client.query(`REVOKE DELETE, TRUNCATE ON TABLE "${t}" FROM ${ident(appRole)}`);
    }
    console.log(`✔ privilégios aplicados para ${appRole} em ${db}`);
  } finally {
    await client.end();
  }
});
