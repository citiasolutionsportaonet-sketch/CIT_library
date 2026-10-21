import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadProductImage } from "@/modules/media/service";
import { createProduct } from "@/modules/products/service";
import { assertTestDb, makeCtx, makeTenant, streamOf } from "./helpers";

let root: string;
let manifestPath: string;
let productId: string;
const targets: string[] = [];

function dbUrl(name: string) {
  const url = new URL(process.env.MIGRATION_DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

function run(script: string, args: string[] = []) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", `scripts/${script}.ts`, ...args], {
      env: { ...process.env, BACKUP_ROOT: root }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => { output += b.toString(); });
    child.stderr.on("data", (b) => { output += b.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

function target() {
  const name = `cit_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}_test`;
  targets.push(name);
  return name;
}

beforeAll(async () => {
  assertTestDb();
  // Os scripts filhos também devem usar SOMENTE o banco sintético de teste.
  if (!new URL(process.env.MIGRATION_DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Backup de regressão exige banco de teste.");
  root = await fs.mkdtemp(path.resolve("var/backup-regression-"));
  const ctx = await makeCtx(await makeTenant(), "OWNER");
  const p = await createProduct(ctx, { name: "Produto sintético para restauração", sku: "BACKUP1" });
  productId = p.id;
  const photo = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#26a" } }).png().toBuffer();
  await uploadProductImage(ctx, p.id, streamOf(photo), "teste.png", photo.length);
  const result = await run("backup");
  expect(result.code, result.output).toBe(0);
  const dirs = await fs.readdir(root, { withFileTypes: true });
  const backup = dirs.find((d) => d.isDirectory() && d.name.startsWith("cit-backup-") && !d.name.endsWith(".parcial"));
  expect(backup).toBeDefined();
  manifestPath = path.join(root, backup!.name, "manifest.json");
});

afterAll(async () => {
  if (targets.length) {
    const admin = new pg.Client({ connectionString: dbUrl("postgres") });
    await admin.connect();
    try {
      for (const name of targets) {
        if (!/^cit_restore_[a-f0-9]{12}_test$/.test(name)) throw new Error("Recusa remover banco fora do teste.");
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally { await admin.end(); }
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("backup e restauração reais", () => {
  it("restaura banco e foto sintéticos, valida contagens e concede acesso ao app", async () => {
    const name = target();
    const mediaTarget = path.join(root, "valid-media");
    const result = await run("restore", ["--manifest", manifestPath, "--target", name, "--media-target", mediaTarget]);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain(`✔ Restaurado em ${name}`);
    expect(result.output).toContain("Arquivos faltando: 0");
    const appUrl = new URL(process.env.DATABASE_URL!);
    appUrl.pathname = `/${name}`;
    const restored = new pg.Client({ connectionString: appUrl.toString() });
    await restored.connect();
    try {
      const p = await restored.query('SELECT name FROM product WHERE id = $1', [productId]);
      expect(p.rows[0].name).toBe("Produto sintético para restauração");
      const photos = await restored.query('SELECT "storageKey" FROM media_asset WHERE state = \'READY\'');
      expect(photos.rows.length).toBeGreaterThan(0);
      for (const photo of photos.rows) {
        for (const variant of ["display", "thumb"]) {
          expect((await fs.stat(path.join(mediaTarget, photo.storageKey, `${variant}.webp`))).isFile()).toBe(true);
        }
      }
    } finally { await restored.end(); }
  });

  it("recusa contagem de mídias divergente mesmo quando produtos e hashes conferem", async () => {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.counts.media += 1;
    const badManifest = path.join(path.dirname(manifestPath), "bad-media-count.json");
    await fs.writeFile(badManifest, JSON.stringify(manifest));
    const name = target();
    const result = await run("restore", ["--manifest", badManifest, "--target", name, "--media-target", path.join(root, "invalid-media")]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Contagens divergentes após restauração");
    expect(result.output).not.toContain("✔ Restaurado");
    expect(result.output).not.toContain("privilégios aplicados");
  });
});
