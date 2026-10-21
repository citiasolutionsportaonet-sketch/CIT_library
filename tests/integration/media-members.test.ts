import pg from "pg";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { openMediaForUser, reorderMedia, setCover, unlinkMedia, uploadProductImage } from "@/modules/media/service";
import { createProduct, getProduct } from "@/modules/products/service";
import { acceptInvitation, changeMemberRole, createInvitation, peekInvitation, setMemberActive } from "@/modules/tenants/service";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { WRITE_LOCK_KEY } from "@/server/maintenance";
import { consumeRateLimit } from "@/server/rate-limit";
import { assertTestDb, makeCtx, makeTenant, makeUser, streamOf } from "./helpers";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof DomainError ? e.code : String(e)));
let jpeg: Buffer;

beforeAll(async () => {
  assertTestDb();
  jpeg = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#2a6" } }).jpeg().toBuffer();
});

const upload = (ctx: Parameters<typeof uploadProductImage>[0], id: string, buf = jpeg, name = "foto.jpg") =>
  uploadProductImage(ctx, id, streamOf(buf), name, buf.length);

describe("fotos", () => {
  it("3 fotos: capa automática, reordenar, trocar capa, remover capa", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    const { id } = await createProduct(ctx, { name: "Foto", sku: "F1" });
    const a = await upload(ctx, id);
    const b = await upload(ctx, id);
    const c = await upload(ctx, id);
    let p = await getProduct(ctx, id);
    expect(p.media.map((m) => m.id)).toEqual([a.mediaId, b.mediaId, c.mediaId]);
    expect(p.coverMediaId).toBe(a.mediaId);
    await reorderMedia(ctx, id, [c.mediaId, a.mediaId, b.mediaId]);
    await setCover(ctx, id, b.mediaId);
    await unlinkMedia(ctx, id, b.mediaId);
    p = await getProduct(ctx, id);
    expect(p.media.map((m) => m.id)).toEqual([c.mediaId, a.mediaId]);
    expect(p.coverMediaId).toBe(c.mediaId);
    expect((await getDb().mediaAsset.findUnique({ where: { id: b.mediaId } }))?.state).toBe("DELETING");
  });

  it("upload inválido é recusado e o produto continua intacto", async () => {
    const ctx = await makeCtx(await makeTenant(), "EDITOR");
    const { id } = await createProduct(ctx, { name: "Inv", sku: "I1" });
    expect(await code(upload(ctx, id, Buffer.from("<html>x</html>"), "x.jpg"))).toBe("UNSUPPORTED_MEDIA");
    expect(await code(upload(ctx, id, Buffer.alloc(11 * 1024 * 1024, 1), "g.jpg"))).toBe("PAYLOAD_TOO_LARGE");
    const truncated = jpeg.subarray(0, 200);
    expect(await code(upload(ctx, id, truncated, "t.jpg"))).toBe("UNSUPPORTED_MEDIA");
    const p = await getProduct(ctx, id);
    expect(p.name).toBe("Inv");
    expect(p.media).toHaveLength(0);
  });

  it("download por ID respeita tenant: outro tenant recebe 404", async () => {
    const ctxA = await makeCtx(await makeTenant(), "OWNER");
    const ctxB = await makeCtx(await makeTenant(), "VIEWER");
    const { id } = await createProduct(ctxA, { name: "M", sku: "M1" });
    const { mediaId } = await upload(ctxA, id);
    const ok = await openMediaForUser(ctxA.userId, mediaId, "thumb");
    ok.stream.destroy();
    expect(await code(openMediaForUser(ctxB.userId, mediaId, "display"))).toBe("NOT_FOUND");
    // Tenant B também não consegue vincular/gerir a foto de A.
    const { id: pb } = await createProduct(await makeCtx({ id: ctxB.tenantId, slug: ctxB.tenantSlug, name: "" }, "OWNER"), { name: "B", sku: "B" });
    expect(await code(setCover(ctxA, pb, mediaId))).toBe("NOT_FOUND");
  });

  it("VIEWER não envia foto", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const viewer = await makeCtx(t, "VIEWER");
    const { id } = await createProduct(owner, { name: "V", sku: "V" });
    expect(await code(upload(viewer, id))).toBe("FORBIDDEN");
  });
});

describe("membros e convites", () => {
  it("último OWNER não pode ser rebaixado nem desativado; ADMIN não toca OWNER", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const admin = await makeCtx(t, "ADMIN");
    const ownerM = await getDb().membership.findFirstOrThrow({ where: { tenantId: t.id, userId: owner.userId } });
    expect(await code(changeMemberRole(admin, ownerM.id, "VIEWER"))).toBe("FORBIDDEN");
    expect(await code(setMemberActive(admin, ownerM.id, false))).toBe("FORBIDDEN");
    const adminM = await getDb().membership.findFirstOrThrow({ where: { tenantId: t.id, userId: admin.userId } });
    expect(await code(changeMemberRole(admin, adminM.id, "OWNER"))).toBe("FORBIDDEN"); // não eleva a si mesmo
    // Dois donos tentando rebaixar um ao outro ao mesmo tempo: o lock FOR UPDATE
    // garante que exatamente um vence e a organização mantém um OWNER ativo.
    const owner2 = await makeCtx(t, "OWNER");
    const owner2M = await getDb().membership.findFirstOrThrow({ where: { tenantId: t.id, userId: owner2.userId } });
    const race = await Promise.all([code(changeMemberRole(owner, owner2M.id, "EDITOR")), code(changeMemberRole(owner2, ownerM.id, "EDITOR"))]);
    expect(race.sort()).toEqual(["CONFLICT", "ok"]);
    expect(await getDb().membership.count({ where: { tenantId: t.id, role: "OWNER", active: true } })).toBe(1);
  });

  it("EDITOR não convida; convite é de uso único e cria usuário", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const editor = await makeCtx(t, "EDITOR");
    expect(await code(createInvitation(editor, "a@b.com", "VIEWER"))).toBe("FORBIDDEN");
    const email = `conv-${Date.now()}@teste.local`;
    const { token } = await createInvitation(owner, email, "VIEWER");
    expect((await peekInvitation(token))?.email).toBe(email);
    const r = await acceptInvitation(token, { sessionUserId: null, name: "Nova", password: "senha-segura-123" });
    expect(r.createdUser).toBe(true);
    expect(await code(acceptInvitation(token, { sessionUserId: null, name: "x", password: "senha-segura-123" }))).toBe("NOT_FOUND");
    const m = await getDb().membership.findFirst({ where: { tenantId: t.id, user: { email } } });
    expect(m?.role).toBe("VIEWER");
    const stored = await getDb().invitation.findFirstOrThrow({ where: { email } });
    expect(stored.tokenHash).not.toContain(token);
  });

  it("convite para e-mail existente exige login da própria conta", async () => {
    const t = await makeTenant();
    const owner = await makeCtx(t, "OWNER");
    const u = await makeUser("Existente");
    const { token } = await createInvitation(owner, u.email, "EDITOR");
    expect(await code(acceptInvitation(token, { sessionUserId: null }))).toBe("UNAUTHENTICATED");
    await expect(acceptInvitation(token, { sessionUserId: u.id })).resolves.toMatchObject({ createdUser: false });
  });
});

describe("operação", () => {
  it("lock de backup bloqueia escritas com MAINTENANCE e libera depois", async () => {
    const ctx = await makeCtx(await makeTenant(), "OWNER");
    const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await c.connect();
    await c.query("SELECT pg_advisory_lock($1::bigint)", [WRITE_LOCK_KEY]);
    try {
      expect(await code(createProduct(ctx, { name: "L", sku: "L1" }))).toBe("MAINTENANCE");
    } finally {
      await c.query("SELECT pg_advisory_unlock($1::bigint)", [WRITE_LOCK_KEY]);
      await c.end();
    }
    await expect(createProduct(ctx, { name: "L", sku: "L1" })).resolves.toBeTruthy();
  });

  it("rate limit persistente é atômico sob concorrência", async () => {
    const key = `test:${Date.now()}`;
    const r = await Promise.all(Array.from({ length: 20 }, () => consumeRateLimit(key, 60, 5)));
    expect(r.filter((x) => x.allowed)).toHaveLength(5);
    expect(r.find((x) => !x.allowed)?.retryAfter).toBeGreaterThan(0);
  });
});
