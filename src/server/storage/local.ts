import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StorageNotFoundError, type StorageProvider } from "./types";

// Chave: segmentos [a-z0-9-] separados por "/", último com extensão simples.
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63})*\/[a-z0-9-]{1,40}\.[a-z0-9]{2,5}$/;

export class LocalStorageProvider implements StorageProvider {
  readonly tmpDir: string;

  constructor(readonly root: string) {
    if (!path.isAbsolute(root)) throw new Error("MEDIA_ROOT precisa ser absoluto");
    this.tmpDir = path.join(root, ".tmp");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700);
    await fs.access(this.root, fs.constants.W_OK);
  }

  /** Resolve a chave dentro da raiz; recusa traversal, absolutos e symlinks. */
  async resolve(key: string): Promise<string> {
    if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Chave de storage inválida");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Chave fora do storage");
    // Nenhum componente existente pode ser link simbólico.
    let cur = this.root;
    for (const part of key.split("/")) {
      cur = path.join(cur, part);
      const st = await fs.lstat(cur).catch(() => null);
      if (!st) break;
      if (st.isSymbolicLink()) throw new Error("Link simbólico recusado no storage");
    }
    return full;
  }

  async put(key: string, data: Buffer | Readable): Promise<void> {
    const dest = await this.resolve(key);
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await fs.mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.tmpDir, `put-${randomUUID()}`);
    try {
      if (Buffer.isBuffer(data)) {
        const fh = await fs.open(tmp, "wx", 0o600);
        try {
          await fh.writeFile(data);
          await fh.sync();
        } finally {
          await fh.close();
        }
      } else {
        await pipeline(data, createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
      }
      // Mesmo volume: rename é atômico.
      await fs.rename(tmp, dest);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Readable> {
    const full = await this.resolve(key);
    const st = await fs.lstat(full).catch(() => null);
    if (!st || !st.isFile()) throw new StorageNotFoundError(key);
    return createReadStream(full);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    const full = await this.resolve(key);
    const st = await fs.lstat(full).catch(() => null);
    return st?.isFile() ? { size: st.size } : null;
  }

  async delete(key: string): Promise<void> {
    const full = await this.resolve(key);
    await fs.rm(full, { force: true });
    // Remove diretórios vazios até a raiz (sem erro se não vazio).
    let dir = path.dirname(full);
    while (dir.startsWith(this.root + path.sep)) {
      try {
        await fs.rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  async *list(prefix = ""): AsyncIterable<string> {
    const base = prefix ? path.join(this.root, prefix) : this.root;
    const walk = async function* (dir: string, rel: string): AsyncIterable<string> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name === ".tmp" && dir === base) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) yield* walk(path.join(dir, e.name), r);
        else if (e.isFile()) yield r;
      }
    };
    for await (const k of walk(base, prefix.replace(/\/$/, ""))) yield k;
  }
}

export { Readable };
