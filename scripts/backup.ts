// Backup consistente: banco (pg_dump custom) + mídias + manifesto com SHA-256.
// Quiescência: toma o advisory lock EXCLUSIVO de escrita. Ele espera as
// transações de escrita em curso terminarem e, enquanto está ativo, toda
// mutação do app/worker falha com "em manutenção" (503). Leituras continuam.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { dbNameFromUrl, main, pgTool, requireEnv } from "./lib/common";
import { sha256, walk } from "./lib/files";

const WRITE_LOCK_KEY = 7_310_001; // mesmo valor de src/server/maintenance.ts

function stamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function dumpTo(file: string, dbName: string): Promise<void> {
  // pg_dump na mesma versão do servidor (local em PG_BIN ou dentro do container).
  const t = pgTool("pg_dump", dbName, ["-Fc"]);
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { mode: 0o600 });
    const p = spawn(t.cmd, t.args, { stdio: ["ignore", "pipe", "inherit"], env: t.env });
    p.stdout.pipe(out);
    p.on("error", reject);
    p.on("exit", (code) => out.close(() => (code === 0 ? resolve() : reject(new Error(`pg_dump saiu com código ${code}`)))));
  });
}

main(async () => {
  const started = new Date();
  const ownerUrl = requireEnv("MIGRATION_DATABASE_URL");
  const dbName = dbNameFromUrl(ownerUrl);
  const mediaRoot = path.resolve(requireEnv("MEDIA_ROOT"));
  const backupRoot = path.resolve(process.env.BACKUP_ROOT || "./var/backups");
  const name = `cit-backup-${stamp(started)}`;
  const dir = path.join(backupRoot, name);
  const work = `${dir}.parcial`;
  await fs.mkdir(path.join(work, "media"), { recursive: true, mode: 0o700 });
  await fs.chmod(backupRoot, 0o700);

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  let lockedAt: Date | null = null;
  try {
    await client.query("SET lock_timeout = '120s'");
    console.log("• Bloqueando escritas (aguardando transações em curso)…");
    await client.query("SELECT pg_advisory_lock($1::bigint)", [WRITE_LOCK_KEY]);
    lockedAt = new Date();

    const meta = await client.query(`SELECT version() AS pg, current_setting('server_version') AS v`);
    const migrations = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
    const tenants = await client.query(`SELECT slug FROM "tenant" ORDER BY slug`);
    const counts = await client.query(`SELECT (SELECT count(*) FROM "product")::int AS products, (SELECT count(*) FROM "media_asset" WHERE state = 'READY')::int AS media`);

    console.log("• Gerando dump do banco…");
    const dumpFile = path.join(work, "database.dump");
    await dumpTo(dumpFile, dbName);

    console.log("• Copiando mídias…");
    const files = await walk(mediaRoot, (r) => r === ".tmp" || r.startsWith(".tmp/"));
    const mediaEntries: { path: string; sha256: string; size: number }[] = [];
    for (const rel of files) {
      const src = path.join(mediaRoot, rel);
      const dest = path.join(work, "media", rel);
      await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
      await fs.copyFile(src, dest);
      await fs.chmod(dest, 0o600);
      const st = await fs.stat(dest);
      mediaEntries.push({ path: `media/${rel}`, sha256: await sha256(dest), size: st.size });
    }

    await client.query("SELECT pg_advisory_unlock($1::bigint)", [WRITE_LOCK_KEY]);
    const unlockedAt = new Date();
    const dumpStat = await fs.stat(dumpFile);
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    const manifest = {
      format: "cit-library-backup/1",
      app: { name: pkg.name, version: pkg.version, commit: gitCommit() },
      createdAtUtc: started.toISOString(),
      postgres: { serverVersion: meta.rows[0].v, full: meta.rows[0].pg },
      database: dbName,
      migrations: migrations.rows.map((r) => r.migration_name),
      tenants: tenants.rows.map((r) => r.slug),
      counts: { ...counts.rows[0], mediaFiles: mediaEntries.length },
      writeLock: { lockedAtUtc: lockedAt.toISOString(), unlockedAtUtc: unlockedAt.toISOString(), seconds: (unlockedAt.getTime() - lockedAt.getTime()) / 1000 },
      database_dump: { path: "database.dump", sha256: await sha256(dumpFile), size: dumpStat.size },
      media: mediaEntries,
      mediaTotalBytes: mediaEntries.reduce((a, b) => a + b.size, 0),
      result: "ok",
      notes: "Contém dados pessoais, hashes de senha e sessões. Guarde criptografado e com acesso restrito. Segredos do .env não estão incluídos.",
    };
    await fs.writeFile(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await fs.rename(work, dir);
    console.log(`\n✔ Backup concluído: ${dir}`);
    console.log(`  Produtos: ${manifest.counts.products} · Mídias READY: ${manifest.counts.media} · Arquivos: ${mediaEntries.length}`);
    console.log(`  Escritas bloqueadas por ${manifest.writeLock.seconds.toFixed(1)} s`);
  } catch (err) {
    await fs.rm(work, { recursive: true, force: true });
    throw err;
  } finally {
    await client.end(); // encerra a sessão e libera o lock em qualquer caso
  }
});
