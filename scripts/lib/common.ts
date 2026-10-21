// Utilitários dos scripts administrativos (fora do Next.js).
// O .env é carregado explicitamente; nenhum segredo é aceito por argumento.
import "dotenv/config";
import { spawn, type SpawnOptions } from "node:child_process";
import readline from "node:readline";

export function fail(msg: string, code = 1): never {
  console.error(`\n✖ ${msg}`);
  process.exit(code);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || /SUBSTITUIR|SENHA_URL_ENCODED/.test(v)) fail(`Configure ${name} no .env (veja .env.example).`);
  return v;
}

export function dbNameFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

/** Lê senha sem eco no terminal e sem gravar em histórico. */
export function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) fail("Execute este comando em um terminal interativo.");
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

/** Executa um comando e propaga falha. Sem shell: argumentos não são interpretados. */
export function run(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0] ?? ""} saiu com código ${code}`))));
  });
}

export async function main(fn: () => Promise<void>) {
  try {
    await fn();
    process.exit(0);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Como chamar ferramentas do PostgreSQL (pg_dump/pg_restore):
 * - PG_BIN definido: binários locais, conexão TCP com a URL do dono; senha
 *   via PGPASSWORD no ambiente do processo filho (nunca em argumentos).
 * - Caso contrário: dentro do container do Compose (socket local).
 */
export function pgTool(tool: "pg_dump" | "pg_restore", dbName: string, extra: string[]): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const owner = new URL(requireEnv("MIGRATION_DATABASE_URL"));
  const bin = process.env.PG_BIN?.replace(/^~/, process.env.HOME ?? "~");
  if (bin) {
    return {
      cmd: `${bin}/${tool}`,
      args: ["-h", owner.hostname, "-p", owner.port || "5432", "-U", decodeURIComponent(owner.username), "-d", dbName, "--no-password", ...extra],
      env: { ...process.env, PGPASSWORD: decodeURIComponent(owner.password) },
    };
  }
  return { cmd: "docker", args: ["compose", "exec", "-T", "db", tool, "-U", "cit", "-d", dbName, "--no-password", ...extra], env: process.env };
}
