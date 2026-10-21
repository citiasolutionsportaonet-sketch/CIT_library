import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), rate: vi.fn(), realFetch: undefined as typeof import("undici").fetch | undefined }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("@/server/rate-limit", () => ({ consumeRateLimit: mocks.rate }));
vi.mock("undici", async (original) => {
  const mod = await original<typeof import("undici")>();
  mocks.realFetch = mod.fetch;
  return { ...mod, fetch: mocks.fetch };
});

import { FetchBlocked, politeFetch, publicLookup } from "@/modules/research/http";

const resolveConnection = (all = false) => new Promise<string | LookupAddress[]>((resolve, reject) => {
  publicLookup("research.example", { all }, (err, addresses) => err ? reject(err) : resolve(addresses));
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.rate.mockResolvedValue({ allowed: true });
});

describe("conexões de pesquisa", () => {
  it("entrega ao socket os próprios endereços DNS validados", async () => {
    const addresses = [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700::1111", family: 6 }];
    mocks.lookup.mockResolvedValue(addresses);
    expect(await resolveConnection(true)).toEqual(addresses);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(await resolveConnection()).toBe("8.8.8.8");
  });

  it.each([
    { addresses: [] },
    { addresses: [{ address: "::ffff:7f00:1", family: 6 }] },
    { addresses: [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] },
  ])("recusa resposta DNS vazia ou com IP interno: %j", async ({ addresses }) => {
    mocks.lookup.mockResolvedValue(addresses);
    await expect(resolveConnection(true)).rejects.toMatchObject({ reason: "ssrf" });
  });

  it("recusa DNS rebinding entre a pré-validação e a abertura do socket", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    // Cliente e conector reais; o DNS interno é recusado antes de abrir socket.
    mocks.fetch.mockImplementation((url, init) => mocks.realFetch!(url, init));
    await expect(politeFetch("https://research.example/a", { respectRobots: false })).rejects.toMatchObject({ reason: "ssrf" });
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("bloqueia redirecionamento para IPv6 mapeado antes da segunda requisição", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://[::ffff:127.0.0.1]/admin" } }));
    await expect(politeFetch("https://research.example/a", { respectRobots: false })).rejects.toMatchObject({ reason: "ssrf" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("mantém limite de tamanho e fecha a resposta recusada", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    mocks.fetch.mockResolvedValue(new Response(stream, { headers: { "content-length": "100" } }));
    await expect(politeFetch("https://research.example/a", { respectRobots: false, maxBytes: 10 })).rejects.toMatchObject({ reason: "size" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("mantém resposta pública e conteúdo", async () => {
    mocks.fetch.mockResolvedValue(new Response("produto", { headers: { "content-type": "text/html" } }));
    const res = await politeFetch("https://research.example/a", { respectRobots: false });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("produto");
    expect(res.headers.get("content-type")).toBe("text/html");
  });

  it("propaga bloqueio do conector embrulhado pelo cliente HTTP", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed", { cause: new FetchBlocked("Destino interno", "ssrf") }));
    await expect(politeFetch("https://research.example/a", { respectRobots: false })).rejects.toMatchObject({ reason: "ssrf" });
  });
});
