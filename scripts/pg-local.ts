// PostgreSQL local SEM Docker, para o ambiente de trabalho (Mac de desenvolvimento).
//   npm run db:local:start   inicializa (1ª vez) e inicia o servidor
//   npm run db:local:stop    para o servidor
//   npm run db:local:status  mostra se está rodando
// Usa binários de PG_BIN (ex.: ~/.local/pgsql/bin, distribuição oficial EDB)
// e dados em PGDATA_DIR (./var/pgdata, fora do Git). Escuta só em 127.0.0.1.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { dbNameFromUrl, fail, main, requireEnv, run, withDbName } from "./lib/common";

const cmd = process.argv[2];

main(async () => {
  const bin = path.resolve(requireEnv("PG_BIN").replace(/^~/, os.homedir()));
  const data = path.resolve(process.env.PGDATA_DIR || "./var/pgdata");
  const sock = path.resolve("var/pgsock");
  const log = path.resolve("var/postgres.log");
  const ownerUrl = new URL(requireEnv("MIGRATION_DATABASE_URL"));
  const port = ownerUrl.port || "5432";
  const pgCtl = (args: string[]) => run(path.join(bin, "pg_ctl"), ["-D", data, ...args]);

  if (cmd === "stop") return pgCtl(["-m", "fast", "-w", "stop"]);
  if (cmd === "status") return pgCtl(["status"]).catch(() => fail("PostgreSQL local parado.", 3));
  if (cmd !== "start") fail("Uso: tsx scripts/pg-local.ts start|stop|status");

  await fs.mkdir(path.dirname(data), { recursive: true, mode: 0o700 });
  await fs.mkdir(sock, { recursive: true, mode: 0o700 });
  const initialized = await fs.stat(path.join(data, "PG_VERSION")).then(() => true, () => false);
  if (!initialized) {
    const user = decodeURIComponent(ownerUrl.username);
    const pwfile = path.join(os.tmpdir(), `cit-pw-${randomUUID()}`);
    await fs.writeFile(pwfile, decodeURIComponent(ownerUrl.password), { mode: 0o600 });
    try {
      await run(path.join(bin, "initdb"), [
        "-D", data, "-U", user, `--pwfile=${pwfile}`,
        "--auth-local=scram-sha-256", "--auth-host=scram-sha-256",
        "--encoding=UTF8", "--locale=en_US.UTF-8",
      ]);
    } finally {
      await fs.rm(pwfile, { force: true });
    }
    await fs.appendFile(
      path.join(data, "postgresql.conf"),
      `\n# CIT Library (local)\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${sock}'\ntimezone = 'UTC'\nlog_timezone = 'UTC'\n`,
    );
    console.log("✔ Cluster inicializado em", data);
  }
  const running = await run(path.join(bin, "pg_ctl"), ["-D", data, "status"], { stdio: "ignore" }).then(() => true, () => false);
  if (!running) await pgCtl(["-l", log, "-w", "start"]);

  const dbName = dbNameFromUrl(ownerUrl.toString());
  const admin = new pg.Client({ connectionString: withDbName(ownerUrl.toString(), "postgres") });
  await admin.connect();
  try {
    const ex = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!ex.rowCount) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
      console.log(`✔ Banco ${dbName} criado`);
    }
  } finally {
    await admin.end();
  }
  console.log(`✔ PostgreSQL local rodando em 127.0.0.1:${port} (log: var/postgres.log)`);
});
