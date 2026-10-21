// Cria o .env a partir do .env.example com segredos aleatórios.
//   npm run env:init                 (Docker: PostgreSQL via docker compose)
//   npm run env:init -- --local-pg   (PostgreSQL local em ~/.local/pgsql/bin)
// Nunca sobrescreve um .env existente e não exibe nenhum segredo.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flag = (n: string) => process.argv.includes(`--${n}`);
if (fs.existsSync(".env")) {
  console.error("✖ Já existe um .env aqui. Nada foi alterado.");
  process.exit(1);
}
const hex = (n: number) => randomBytes(n).toString("hex");
const pgPw = hex(24);
const appPw = hex(24);
let text = fs.readFileSync(".env.example", "utf8")
  .replaceAll("SUBSTITUIR_SENHA_DONO_DO_BANCO", pgPw)
  .replaceAll("SUBSTITUIR_SENHA_APP", appPw)
  .replace("SUBSTITUIR_SEGREDO_ALEATORIO", hex(32));
if (flag("local-pg")) {
  const bin = path.join(os.homedir(), ".local", "pgsql", "bin");
  text += `\n# PostgreSQL local sem Docker\nPG_BIN=${bin}\nPGDATA_DIR=./var/pgdata\n`;
}
fs.writeFileSync(".env", text, { mode: 0o600 });
console.log(`✔ .env criado com senhas aleatórias${flag("local-pg") ? " (PostgreSQL local)" : " (Docker)"}. Ajuste as URLs se for acessar por outro Mac (docs/rede-local.md).`);
