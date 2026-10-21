import "server-only";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { audit } from "@/server/audit";
import { getDb, type Tx } from "@/server/db";
import { getEnv } from "@/server/env";
import { DomainError, logError, notFound, validation } from "@/server/errors";
import { writeTx } from "@/server/maintenance";
import { getStorage } from "@/server/storage";
import { assertCan, type TenantContext } from "@/server/authorize";
import { checkImageFile, processImage, sanitizeOriginalName, sha256File } from "./image";

export type Variant = "display" | "thumb";
export const variantKey = (storageKey: string, v: Variant) => `${storageKey}/${v}.webp`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limita processamentos simultâneos de imagem neste processo.
let running = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

async function lockProduct(tx: Tx, tenantId: string, productId: string) {
  const rows = await tx.$queryRaw<{ id: string; status: string; coverMediaId: string | null }[]>`
    SELECT "id", "status"::text, "coverMediaId" FROM "product"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${productId}::uuid FOR UPDATE`;
  if (!rows[0]) throw notFound("Produto");
  return rows[0];
}

/** Grava o corpo em arquivo temporário, contando bytes durante o streaming. */
async function streamToTemp(body: ReadableStream<Uint8Array>, dest: string, maxBytes: number): Promise<number> {
  let total = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) cb(new DomainError("PAYLOAD_TOO_LARGE", `Arquivo acima do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`));
      else cb(null, chunk);
    },
  });
  // "wx": falha se o temporário já existir; o stream fecha o arquivo ao terminar.
  await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), counter, createWriteStream(dest, { flags: "wx", mode: 0o600 }));
  return total;
}

export type UploadResult = { mediaId: string; width: number; height: number };

/**
 * Upload de foto: limite no streaming → MIME por conteúdo → decodificação
 * real e reencode (Sharp) → derivados gravados atomicamente → estado READY e
 * vínculo ao produto na mesma transação. Falhas deixam o asset FAILED e
 * removem arquivos; o produto não é alterado.
 */
export async function uploadProductImage(
  ctx: TenantContext,
  productId: string,
  body: ReadableStream<Uint8Array> | null,
  rawName: string,
  declaredLength: number | null,
): Promise<UploadResult> {
  assertCan(ctx, "products:write");
  if (!UUID.test(productId)) throw notFound("Produto");
  if (!body) throw validation({ file: "Nenhum arquivo enviado." });
  const env = getEnv();
  const maxBytes = env.MEDIA_MAX_IMAGE_BYTES;
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new DomainError("PAYLOAD_TOO_LARGE", `Arquivo acima do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const originalName = sanitizeOriginalName(rawName);
  const db = getDb();

  // Pré-checagens baratas (repetidas dentro da transação final).
  const product = await db.product.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { status: true, _count: { select: { media: true } } },
  });
  if (!product) throw notFound("Produto");
  if (product.status === "ARCHIVED") throw new DomainError("CONFLICT", "Restaure o produto antes de adicionar fotos.");
  if (product._count.media >= env.MEDIA_MAX_PER_PRODUCT) {
    throw new DomainError("CONFLICT", `Limite de ${env.MEDIA_MAX_PER_PRODUCT} fotos por produto atingido.`);
  }
  const used = await db.mediaAsset.aggregate({ where: { tenantId: ctx.tenantId, state: { in: ["READY", "PENDING"] } }, _sum: { byteSize: true } });
  if ((used._sum.byteSize ?? 0) + (declaredLength ?? 0) > env.MEDIA_TENANT_QUOTA_BYTES) {
    throw new DomainError("CONFLICT", "Cota de armazenamento da organização atingida.");
  }

  const storage = await getStorage();
  const tmp = path.join(storage.tmpDir, `upload-${randomUUID()}`);
  let assetId: string | null = null;
  let storageKey: string | null = null;
  try {
    const size = await streamToTemp(body, tmp, maxBytes);
    if (size === 0) throw validation({ file: "Arquivo vazio." });

    const check = await checkImageFile(tmp, originalName);
    if (!check.ok) {
      const msg =
        check.reason === "heic"
          ? "Fotos HEIC (padrão do iPhone) ainda não são aceitas. No Mac, abra no app Fotos ou Pré-Visualização e exporte como JPEG ou PNG."
          : check.reason === "extension"
            ? "A extensão do arquivo não corresponde ao conteúdo. Use .jpg, .jpeg, .png ou .webp."
            : "Formato não aceito. Envie JPEG, PNG ou WebP.";
      throw new DomainError("UNSUPPORTED_MEDIA", msg, { file: msg });
    }
    const sha256 = await sha256File(tmp);

    const id = randomUUID();
    storageKey = `${ctx.tenantId}/${id.slice(0, 2)}/${id}`;
    await writeTx(async (tx) => {
      await tx.mediaAsset.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          storageKey: storageKey!,
          originalName,
          detectedMime: check.mime,
          byteSize: size,
          sha256,
          kind: "IMAGE",
          state: "PENDING",
          createdById: ctx.userId,
        },
      });
    });
    assetId = id;

    let processed;
    try {
      processed = await withSlot(() => processImage(tmp));
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError("UNSUPPORTED_MEDIA", "Não foi possível ler a imagem (arquivo corrompido ou acima de 40 megapixels).", {
        file: "Imagem inválida ou grande demais.",
      });
    }
    await storage.put(variantKey(storageKey, "display"), processed.display);
    await storage.put(variantKey(storageKey, "thumb"), processed.thumb);

    await writeTx(async (tx) => {
      const p = await lockProduct(tx, ctx.tenantId, productId);
      if (p.status === "ARCHIVED") throw new DomainError("CONFLICT", "Restaure o produto antes de adicionar fotos.");
      const agg = await tx.productMedia.aggregate({ where: { tenantId: ctx.tenantId, productId }, _count: true, _max: { position: true } });
      if (agg._count >= env.MEDIA_MAX_PER_PRODUCT) throw new DomainError("CONFLICT", `Limite de ${env.MEDIA_MAX_PER_PRODUCT} fotos por produto atingido.`);
      await tx.mediaAsset.update({ where: { id }, data: { state: "READY", width: processed.width, height: processed.height } });
      await tx.productMedia.create({
        data: { tenantId: ctx.tenantId, productId, mediaId: id, position: (agg._max.position ?? -1) + 1, altText: "" },
      });
      if (!p.coverMediaId) await tx.product.update({ where: { id: productId }, data: { coverMediaId: id } });
      await audit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId,
        action: "product.media.add",
        entityType: "Product",
        entityId: productId,
        diff: { mediaId: id, originalName, byteSize: size, sha256 },
      });
    });
    return { mediaId: id, width: processed.width, height: processed.height };
  } catch (err) {
    // Compensação: banco e disco não compartilham transação.
    if (storageKey) {
      await storage.delete(variantKey(storageKey, "display")).catch(() => {});
      await storage.delete(variantKey(storageKey, "thumb")).catch(() => {});
    }
    if (assetId) {
      await db.mediaAsset.update({ where: { id: assetId }, data: { state: "FAILED" } }).catch((e) => logError(e, ctx.requestId, { op: "media.markFailed" }));
    }
    throw err;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Gestão da galeria
// ---------------------------------------------------------------------------

async function linkedReady(tx: Tx, tenantId: string, productId: string) {
  return tx.productMedia.findMany({
    where: { tenantId, productId, media: { state: "READY" } },
    orderBy: [{ position: "asc" }, { mediaId: "asc" }],
    select: { mediaId: true, position: true },
  });
}

export async function reorderMedia(ctx: TenantContext, productId: string, orderedIds: string[]) {
  assertCan(ctx, "products:write");
  if (!UUID.test(productId)) throw notFound("Produto");
  await writeTx(async (tx) => {
    await lockProduct(tx, ctx.tenantId, productId);
    const links = await linkedReady(tx, ctx.tenantId, productId);
    const current = new Set(links.map((l) => l.mediaId));
    if (orderedIds.length !== current.size || !orderedIds.every((id) => current.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
      throw new DomainError("CONFLICT", "A lista de fotos mudou. Recarregue a página e tente de novo.");
    }
    for (const [i, mediaId] of orderedIds.entries()) {
      await tx.productMedia.update({ where: { productId_mediaId: { productId, mediaId } }, data: { position: i } });
    }
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "product.media.reorder", entityType: "Product", entityId: productId, diff: { order: orderedIds } });
  });
}

export async function setCover(ctx: TenantContext, productId: string, mediaId: string) {
  assertCan(ctx, "products:write");
  if (!UUID.test(productId) || !UUID.test(mediaId)) throw notFound("Foto");
  await writeTx(async (tx) => {
    await lockProduct(tx, ctx.tenantId, productId);
    const link = await tx.productMedia.findFirst({ where: { tenantId: ctx.tenantId, productId, mediaId, media: { state: "READY" } } });
    if (!link) throw notFound("Foto");
    await tx.product.update({ where: { id: productId }, data: { coverMediaId: mediaId } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "product.media.cover", entityType: "Product", entityId: productId, diff: { mediaId } });
  });
}

export async function updateAltText(ctx: TenantContext, productId: string, mediaId: string, altRaw: string) {
  assertCan(ctx, "products:write");
  if (!UUID.test(productId) || !UUID.test(mediaId)) throw notFound("Foto");
  const altText = String(altRaw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (altText.length > 250) throw validation({ altText: "Texto alternativo: máximo de 250 caracteres." });
  await writeTx(async (tx) => {
    const res = await tx.productMedia.updateMany({ where: { tenantId: ctx.tenantId, productId, mediaId }, data: { altText } });
    if (res.count !== 1) throw notFound("Foto");
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "product.media.alt", entityType: "Product", entityId: productId, diff: { mediaId, altText } });
  });
}

/**
 * Remove o vínculo da foto com o produto. Se era capa, a próxima foto vira
 * capa na mesma transação. Asset sem vínculos fica DELETING e só é apagado do
 * disco pela reconciliação após a carência (npm run media:reconcile).
 */
export async function unlinkMedia(ctx: TenantContext, productId: string, mediaId: string) {
  assertCan(ctx, "products:write");
  if (!UUID.test(productId) || !UUID.test(mediaId)) throw notFound("Foto");
  await writeTx(async (tx) => {
    const p = await lockProduct(tx, ctx.tenantId, productId);
    const link = await tx.productMedia.findFirst({ where: { tenantId: ctx.tenantId, productId, mediaId } });
    if (!link) throw notFound("Foto");
    if (p.coverMediaId === mediaId) {
      const next = (await linkedReady(tx, ctx.tenantId, productId)).find((l) => l.mediaId !== mediaId);
      await tx.product.update({ where: { id: productId }, data: { coverMediaId: next?.mediaId ?? null } });
    }
    await tx.productMedia.delete({ where: { productId_mediaId: { productId, mediaId } } });
    const remaining = await tx.productMedia.count({ where: { tenantId: ctx.tenantId, mediaId } });
    if (remaining === 0) await tx.mediaAsset.update({ where: { id: mediaId }, data: { state: "DELETING" } });
    await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, requestId: ctx.requestId, action: "product.media.remove", entityType: "Product", entityId: productId, diff: { mediaId } });
  });
}

// ---------------------------------------------------------------------------
// Download autorizado
// ---------------------------------------------------------------------------

/**
 * Autoriza leitura de mídia por ID para um usuário autenticado: exige asset
 * READY, membership ativa no tenant do asset e permissão de catálogo.
 * Mídia de outro tenant responde exatamente como inexistente (404).
 */
export async function openMediaForUser(userId: string, mediaId: string, variant: Variant) {
  if (!UUID.test(mediaId)) throw notFound("Arquivo");
  const db = getDb();
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, state: "READY" }, select: { tenantId: true, storageKey: true, kind: true } });
  if (!asset) throw notFound("Arquivo");
  const membership = await db.membership.findFirst({
    where: { userId, tenantId: asset.tenantId, active: true, tenant: { status: "ACTIVE" } },
    select: { role: true },
  });
  if (!membership) throw notFound("Arquivo");
  const storage = await getStorage();
  const key = variantKey(asset.storageKey, variant);
  const st = await storage.stat(key);
  if (!st) throw notFound("Arquivo");
  return { stream: await storage.get(key), size: st.size, contentType: "image/webp" };
}
