// Restauração em destino NOVO e explícito. Nunca sobrescreve.
//   npm run restore -- --manifest var/backups/<nome>/manifest.json --target cit_restore_teste [--media-target DIR]
// Valida todos os hashes antes de carregar, recusa caminhos inseguros e
// revoga as sessões copiadas no banco restaurado.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { arg, dbNameFromUrl, main, pgTool, requireEnv, run, withDbName } from "./lib/common";
import { safeRel, sha256 } from "./lib/files";

type Manifest = {
  format: string;
  database_dump: { path: string; sha256: string; size: number };
  media: { path: string; sha256: string; size: number }[];
  counts: { products: number; media: number };
};

function restoreDump(file: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Sem dono e sem privilégios do servidor de origem: os papéis podem não
    // existir no destino; os grants corretos são reaplicados ao final.
    const t = pgTool("pg_restore", target, ["--no-owner", "--no-privileges", "--exit-on-error"]);
    const p = spawn(t.cmd, t.args, { stdio: ["pipe", "inherit", "inherit"], env: t.env });
    createReadStream(file).pipe(p.stdin);
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`pg_restore saiu com código ${c}`))));
  });
}

main(async () => {
  const manifestPath = arg("manifest");
  const target = arg("target");
  if (!manifestPath || !target) throw new Error("Uso: npm run restore -- --manifest CAMINHO --target BANCO_NOVO [--media-target DIR]");
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(target)) throw new Error("--target deve ser um nome simples (a-z, 0-9, _).");
  const ownerUrl = requireEnv("MIGRATION_DATABASE_URL");
  if (target === "postgres" || target.startsWith("template")) throw new Error("Destino inválido.");
  // Migração para outro computador: restaurar no banco configurado é permitido
  // desde que ele AINDA NÃO EXISTA (verificado abaixo); nada é sobrescrito.
  const intoConfigured = target === dbNameFromUrl(ownerUrl);

  const baseDir = path.dirname(path.resolve(manifestPath));
  const m = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
  if (m.format !== "cit-library-backup/1") throw new Error("Manifesto em formato desconhecido.");
  const mediaTarget = path.resolve(arg("media-target") || path.join(path.dirname(baseDir), `restore-${target}`, "media"));

  console.log("• Validando hashes…");
  const all = [m.database_dump, ...m.media];
  for (const f of all) {
    if (!safeRel(f.path)) throw new Error(`Caminho inseguro no manifesto: ${f.path}`);
    const full = path.resolve(baseDir, f.path);
    if (!full.startsWith(baseDir + path.sep)) throw new Error(`Caminho fora do backup: ${f.path}`);
    const st = await fs.lstat(full).catch(() => null);
    if (!st?.isFile()) throw new Error(`Arquivo ausente ou não regular: ${f.path}`);
    if (st.size !== f.size || (await sha256(full)) !== f.sha256) throw new Error(`Hash/tamanho não confere: ${f.path}`);
  }
  console.log(`  ${all.length} arquivo(s) conferidos.`);

  const existing = await fs.readdir(mediaTarget).catch(() => null);
  if (existing && existing.length > 0) throw new Error(`Diretório de mídia de destino não está vazio: ${mediaTarget}`);

  const admin = new pg.Client({ connectionString: withDbName(ownerUrl, "postgres") });
  await admin.connect();
  try {
    const ex = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
    if (ex.rowCount) {
      // Banco já criado mas VAZIO (ex.: Docker com POSTGRES_DB ou db:local:start)
      // pode receber a restauração. Qualquer tabela existente = recusa.
      const probe = new pg.Client({ connectionString: withDbName(ownerUrl, target) });
      await probe.connect();
      const tables = (await probe.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'")).rows[0].n as number;
      await probe.end();
      if (tables > 0) {
        throw new Error(
          intoConfigured
            ? `O banco ${target} já tem ${tables} tabela(s) neste computador. Para migrar, use um banco vazio (não rode db:deploy antes da restauração); nada foi alterado.`
            : `O banco ${target} já existe e não está vazio. Escolha outro nome; nada foi alterado.`,
        );
      }
      console.log(`• Banco ${target} existe e está vazio: restaurando nele.`);
    } else {
      await admin.query(`CREATE DATABASE "${target}"`);
    }
  } finally {
    await admin.end();
  }

  console.log("• Restaurando banco…");
  await restoreDump(path.resolve(baseDir, m.database_dump.path), target);

  console.log("• Restaurando mídias…");
  for (const f of m.media) {
    const rel = f.path.replace(/^media\//, "");
    const dest = path.join(mediaTarget, rel);
    if (!dest.startsWith(mediaTarget + path.sep)) throw new Error(`Caminho inseguro: ${f.path}`);
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await fs.copyFile(path.resolve(baseDir, f.path), dest);
  }
  await fs.mkdir(mediaTarget, { recursive: true, mode: 0o700 });

  const restored = new pg.Client({ connectionString: withDbName(ownerUrl, target) });
  await restored.connect();
  try {
    // Ambiente restaurado não herda sessões ativas.
    await restored.query(`DELETE FROM "session"`);
    const c = await restored.query(`SELECT (SELECT count(*) FROM "product")::int AS products, (SELECT count(*) FROM "media_asset" WHERE state='READY')::int AS media`);
    const keys = await restored.query(`SELECT "storageKey" FROM "media_asset" WHERE state = 'READY'`);
    let missing = 0;
    for (const r of keys.rows) {
      for (const v of ["display", "thumb"]) {
        if (!(await fs.stat(path.join(mediaTarget, `${r.storageKey}/${v}.webp`)).catch(() => null))) missing++;
      }
    }
    console.log(`\n✔ Restaurado em ${target}`);
    console.log(`  Produtos: ${c.rows[0].products} (backup: ${m.counts.products}) · Mídias: ${c.rows[0].media} (backup: ${m.counts.media}) · Arquivos faltando: ${missing}`);
    if (missing || c.rows[0].products !== m.counts.products) throw new Error("Contagens divergentes após restauração.");
  } finally {
    await restored.end();
  }
  const appUrl = new URL(requireEnv("DATABASE_URL"));
  await run("npx", ["tsx", "scripts/db-grants.ts"], { env: { ...process.env, GRANTS_DATABASE_URL: withDbName(ownerUrl, target), GRANTS_APP_DATABASE_URL: withDbName(appUrl.toString(), target) } });
  console.log(`\nPara testar isoladamente, use um .env separado com:\n  DATABASE_URL=<mesma URL do app com /${target}>\n  MEDIA_ROOT=${mediaTarget}\n(sessões foram revogadas; todos precisarão entrar de novo.)`);
});
