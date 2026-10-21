import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";

// Processamento isolado do resto do domínio para ser testável sem banco.
sharp.cache(false);
sharp.concurrency(2);

export const MAX_INPUT_PIXELS = 40_000_000;
export const DISPLAY_MAX = 2048;
export const THUMB_MAX = 480;

export const ALLOWED_IMAGE: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

export type ImageCheck =
  | { ok: true; mime: string }
  | { ok: false; reason: "heic" | "unsupported" | "extension" };

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Tipo detectado pelo conteúdo (magic bytes), nunca pelo nome ou Content-Type. */
export async function checkImageFile(filePath: string, originalName: string): Promise<ImageCheck> {
  const ft = await fileTypeFromFile(filePath);
  const ext = extensionOf(originalName);
  if (ft && (ft.mime === "image/heic" || ft.mime === "image/heif" || ft.ext === "heic")) return { ok: false, reason: "heic" };
  if (["heic", "heif"].includes(ext)) return { ok: false, reason: "heic" };
  if (!ft || !ALLOWED_IMAGE[ft.mime]) return { ok: false, reason: "unsupported" };
  if (!ALLOWED_IMAGE[ft.mime].includes(ext)) return { ok: false, reason: "extension" };
  return { ok: true, mime: ft.mime };
}

export async function sha256File(filePath: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export type ProcessedImage = { width: number; height: number; display: Buffer; thumb: Buffer };

/**
 * Decodifica de verdade, corrige orientação (EXIF) e reencoda em WebP.
 * Sharp descarta metadados (EXIF/GPS/ICC extra) por padrão na saída.
 */
export async function processImage(filePath: string): Promise<ProcessedImage> {
  const base = () => sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", sequentialRead: true }).rotate();
  const meta = await base().metadata();
  if (!meta.width || !meta.height) throw new Error("Imagem sem dimensões");
  const [display, thumb] = await Promise.all([
    base().resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    base().resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
  ]);
  const oriented = (meta.orientation ?? 1) >= 5;
  return {
    width: oriented ? meta.height : meta.width,
    height: oriented ? meta.width : meta.height,
    display,
    thumb,
  };
}

/** Nome original apenas como metadado: sem caminho, controles ou excesso. */
export function sanitizeOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (clean || "imagem").slice(0, 200);
}
