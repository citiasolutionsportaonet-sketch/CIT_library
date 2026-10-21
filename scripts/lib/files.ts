import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest("hex");
}

/** Lista arquivos regulares (sem seguir links simbólicos), caminhos relativos com "/". */
export async function walk(root: string, skip: (rel: string) => boolean = () => false): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await rec(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  }
  await rec(root, "");
  return out.sort();
}

/** Caminho relativo seguro: sem absoluto, "..", barra invertida ou controles. */
export function safeRel(rel: string): boolean {
  return !!rel && !path.isAbsolute(rel) && !rel.split("/").some((p) => p === ".." || p === "." || p === "") && !/[\\\u0000-\u001f]/.test(rel);
}
