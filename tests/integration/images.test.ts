import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Só o download é simulado (SSRF bloqueia servidor local); pipeline, galeria e banco são reais.
vi.mock("@/modules/research/http", async (orig) => {
  const mod = await orig<typeof import("@/modules/research/http")>();
  return {
    ...mod,
    politeFetch: vi.fn(async (url: string) => {
      const color = url.includes("b.") ? "#22a" : url.includes("c.") ? "#2a2" : url.includes("d.") ? "#aa2" : "#a22";
      // Simula CDN que negocia formato: URL ".jpg" devolve PNG.
      const body = await sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).png().toBuffer();
      return { status: 200, url, contentType: "image/png", body, headers: new Headers() };
    }),
  };
});

import { bulkApproveOfficialImages } from "@/modules/research/service";
import { createProduct, getProduct } from "@/modules/products/service";
import { getDb } from "@/server/db";
import { assertTestDb, makeCtx, makeTenant } from "./helpers";

beforeAll(() => assertTestDb());

describe("imagens oficiais para a galeria", () => {
  it("aprova até 3 oficiais verificadas, maiores primeiro; revendedor fica; idempotente", async () => {
    const t = await makeTenant();
    const ctx = await makeCtx(t, "OWNER");
    const { id } = await createProduct(ctx, { name: "Câmera VIP 1230 B G5", sku: "V1" });
    const base = { tenantId: t.id, productId: id, kind: "IMAGE" as const, origin: "ENGINE" as const, verifiedAt: new Date(), height: 600 };
    await getDb().researchAsset.createMany({
      data: [
        { ...base, url: "https://backend.intelbras.com/a.jpg", sourceType: "OFFICIAL", sourceName: "intelbras", width: 700, sha256: "a" },
        { ...base, url: "https://backend.intelbras.com/b.jpg", sourceType: "OFFICIAL", sourceName: "intelbras", width: 1200, sha256: "b" },
        { ...base, url: "https://backend.intelbras.com/c.jpg", sourceType: "OFFICIAL", sourceName: "intelbras", width: 900, sha256: "c" },
        { ...base, url: "https://backend.intelbras.com/d.jpg", sourceType: "OFFICIAL", sourceName: "intelbras", width: 400, sha256: "d" },
        { ...base, url: "https://loja.exemplo/e.jpg", sourceType: "RESELLER", sourceName: "loja", width: 2000, sha256: "e" },
      ],
    });
    const r = await bulkApproveOfficialImages(ctx);
    expect(r).toMatchObject({ products: 1, approved: 3 });
    const assets = await getDb().researchAsset.findMany({ where: { productId: id }, orderBy: { url: "asc" } });
    expect(assets.map((a) => [a.url.split("/").pop(), a.status])).toEqual([
      ["a.jpg", "ACCEPTED"], ["b.jpg", "ACCEPTED"], ["c.jpg", "ACCEPTED"], ["d.jpg", "CANDIDATE"], ["e.jpg", "CANDIDATE"],
    ]);
    const p = await getProduct(ctx, id);
    expect(p.media).toHaveLength(3);
    expect(p.coverMediaId).toBeTruthy();
    expect(assets.filter((a) => a.mediaId).length).toBe(3);
    expect((await bulkApproveOfficialImages(ctx)).approved).toBe(0);
  });

  it("VIEWER não aprova imagens", async () => {
    const t = await makeTenant();
    const viewer = await makeCtx(t, "VIEWER");
    await expect(bulkApproveOfficialImages(viewer)).rejects.toThrow();
  });
});
