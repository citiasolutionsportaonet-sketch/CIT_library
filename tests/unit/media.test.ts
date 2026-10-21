import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkImageFile, processImage, sanitizeOriginalName } from "@/modules/media/image";
import { LocalStorageProvider } from "@/server/storage/local";
import { safeRel } from "../../scripts/lib/files";

let dir: string;
const file = (n: string) => path.join(dir, n);

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cit-media-"));
  const base = sharp({ create: { width: 64, height: 32, channels: 3, background: "#c33" } });
  await base.clone().jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: "Segredo", Copyright: "GPS teste" } } }).toFile(file("foto.jpg"));
  await base.clone().png().toFile(file("foto.png"));
  await fs.writeFile(file("falso.jpg"), "<html><script>alert(1)</script></html>");
  await fs.writeFile(file("svg.png"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  // Cabeçalho ftyp HEIC mínimo (somente detecção de tipo).
  const heic = Buffer.alloc(64);
  heic.writeUInt32BE(24, 0);
  heic.write("ftypheic", 4, "ascii");
  heic.write("mif1heic", 16, "ascii");
  await fs.writeFile(file("iphone.heic"), heic);
  const jpg = await fs.readFile(file("foto.jpg"));
  await fs.writeFile(file("truncada.jpg"), jpg.subarray(0, Math.floor(jpg.length / 3)));
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("detecção de tipo por conteúdo", () => {
  it("aceita JPEG e PNG reais", async () => {
    expect(await checkImageFile(file("foto.jpg"), "foto.jpg")).toEqual({ ok: true, mime: "image/jpeg" });
    expect(await checkImageFile(file("foto.png"), "foto.png")).toEqual({ ok: true, mime: "image/png" });
  });
  it("recusa MIME falso (HTML com extensão .jpg)", async () => {
    expect((await checkImageFile(file("falso.jpg"), "falso.jpg")).ok).toBe(false);
  });
  it("recusa SVG", async () => {
    expect((await checkImageFile(file("svg.png"), "svg.png")).ok).toBe(false);
  });
  it("recusa extensão que não corresponde ao conteúdo", async () => {
    expect(await checkImageFile(file("foto.png"), "foto.jpg")).toEqual({ ok: false, reason: "extension" });
  });
  it("identifica HEIC com motivo próprio", async () => {
    expect(await checkImageFile(file("iphone.heic"), "IMG_0001.HEIC")).toEqual({ ok: false, reason: "heic" });
  });
});

describe("processamento", () => {
  it("corrige orientação, gera WebP e remove EXIF", async () => {
    const r = await processImage(file("foto.jpg"));
    expect([r.width, r.height]).toEqual([32, 64]); // orientação 6 = girada 90°
    const meta = await sharp(r.display).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(r.display.includes(Buffer.from("Segredo"))).toBe(false);
  });
  it("falha em imagem truncada", async () => {
    await expect(processImage(file("truncada.jpg"))).rejects.toThrow();
  });
  it("sanitiza nome original", () => {
    expect(sanitizeOriginalName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeOriginalName("C:\\fotos\\a<b>.jpg")).toBe("ab.jpg");
  });
});

describe("storage local", () => {
  it("grava atomicamente e lê", async () => {
    const s = new LocalStorageProvider(path.join(dir, "store"));
    await s.init();
    await s.put("t1/ab/x/display.webp", Buffer.from("ok"));
    expect(await s.stat("t1/ab/x/display.webp")).toEqual({ size: 2 });
    const keys: string[] = [];
    for await (const k of s.list()) keys.push(k);
    expect(keys).toEqual(["t1/ab/x/display.webp"]);
    await s.delete("t1/ab/x/display.webp");
    expect(await s.stat("t1/ab/x/display.webp")).toBeNull();
  });
  it("recusa traversal e caminhos absolutos", async () => {
    const s = new LocalStorageProvider(path.join(dir, "store"));
    await expect(s.put("../fora/x.webp", Buffer.from("x"))).rejects.toThrow();
    await expect(s.put("/etc/x.webp", Buffer.from("x"))).rejects.toThrow();
    await expect(s.get("a/../../x.webp")).rejects.toThrow();
  });
  it("recusa links simbólicos", async () => {
    const root = path.join(dir, "store2");
    const s = new LocalStorageProvider(root);
    await s.init();
    await fs.symlink(os.tmpdir(), path.join(root, "link"));
    await expect(s.put("link/x/display.webp", Buffer.from("x"))).rejects.toThrow(/simbólico/);
  });
  it("valida caminhos de backup", () => {
    expect(safeRel("media/a/b.webp")).toBe(true);
    expect(safeRel("../x")).toBe(false);
    expect(safeRel("/abs")).toBe(false);
    expect(safeRel("a//b")).toBe(false);
  });
});
