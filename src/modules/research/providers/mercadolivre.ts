import "server-only";
import type { OfferCondition } from "@/generated/prisma/enums";
import { getDb } from "@/server/db";
import type { ProviderResult, ResearchProduct, ResearchProvider } from "./types";

// API oficial do Mercado Livre. Credenciais: ML_CLIENT_ID + ML_CLIENT_SECRET no
// .env e o refresh token obtido por `npm run ml:auth`. O Mercado Livre troca o
// refresh token a cada renovação (o anterior deixa de valer), por isso o token
// vigente fica em system_state e é atualizado a cada renovação.
// Atenção: há relatos de 403 em /sites/MLB/search mesmo autenticado.
const STATE_KEY = "mercadolivre_oauth";
let cached: { value: string; until: number } | null = null;

type OAuthState = { refreshToken: string; updatedAt: string };

export async function saveMlRefreshToken(refreshToken: string) {
  await getDb().systemState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value: { refreshToken, updatedAt: new Date().toISOString() } satisfies OAuthState },
    update: { value: { refreshToken, updatedAt: new Date().toISOString() } satisfies OAuthState },
  });
}

async function accessToken(): Promise<string> {
  if (process.env.ML_ACCESS_TOKEN) return process.env.ML_ACCESS_TOKEN;
  if (cached && cached.until > Date.now() + 60_000) return cached.value;
  const db = getDb();
  return db.$transaction(async (tx) => {
    // Serializa renovações entre processos (o refresh token é de uso único).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7310003)`;
    if (cached && cached.until > Date.now() + 60_000) return cached.value;
    const state = (await tx.systemState.findUnique({ where: { key: STATE_KEY } }))?.value as OAuthState | undefined;
    const refreshToken = state?.refreshToken ?? process.env.ML_REFRESH_TOKEN;
    if (!refreshToken) throw Object.assign(new Error("Mercado Livre sem autorização: rode npm run ml:auth."), { retryable: false });
    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: process.env.ML_CLIENT_ID!, client_secret: process.env.ML_CLIENT_SECRET!, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw Object.assign(new Error(`Mercado Livre OAuth respondeu ${res.status}: rode npm run ml:auth novamente.`), { retryable: false });
    const j = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    if (j.refresh_token) {
      await tx.systemState.upsert({
        where: { key: STATE_KEY },
        create: { key: STATE_KEY, value: { refreshToken: j.refresh_token, updatedAt: new Date().toISOString() } },
        update: { value: { refreshToken: j.refresh_token, updatedAt: new Date().toISOString() } },
      });
    }
    cached = { value: j.access_token, until: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  });
}

export async function searchMl(q: string, limit = 20) {
  const url = `https://api.mercadolibre.com/sites/MLB/search?${new URLSearchParams({ q, limit: String(limit), condition: "new" })}`;
  return fetch(url, { headers: { authorization: `Bearer ${await accessToken()}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
}

export const mercadoLivreProvider: ResearchProvider = {
  id: "mercadolivre",
  label: "Mercado Livre (API oficial)",
  paid: true,
  costPerCallCents: () => Number(process.env.ML_COST_CENTS_PER_CALL ?? 0),
  configured: () => !!process.env.ML_ACCESS_TOKEN || !!(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET),
  plannedCalls: () => 1,
  async run(p: ResearchProduct): Promise<ProviderResult> {
    const out: ProviderResult = { assets: [], offers: [], notes: [], paidCalls: 1 };
    const q = [p.brand, p.model ?? p.name].filter(Boolean).join(" ");
    const res = await searchMl(q);
    if (res.status === 429) throw Object.assign(new Error("Mercado Livre: limite de requisições"), { retryAfter: 120 });
    if (res.status === 403) throw Object.assign(new Error("Mercado Livre recusou a busca (403). Verifique permissões do app."), { retryable: false });
    if (!res.ok) throw new Error(`Mercado Livre respondeu ${res.status}`);
    const data = (await res.json()) as {
      results?: { title: string; price: number; currency_id: string; condition: string; permalink: string; seller?: { nickname?: string }; official_store_name?: string }[];
    };
    for (const r of data.results ?? []) {
      if (!r.permalink || !(r.price > 0) || r.currency_id !== "BRL") continue;
      const condition: OfferCondition = r.condition === "new" ? "NEW" : r.condition === "used" ? "USED" : "UNKNOWN";
      out.offers.push({
        provider: "mercadolivre",
        sourceName: `Mercado Livre - ${r.official_store_name ?? r.seller?.nickname ?? "vendedor"}`.slice(0, 120),
        url: r.permalink,
        title: r.title.slice(0, 300),
        price: String(r.price),
        currency: "BRL",
        condition,
      });
    }
    if (out.offers.length === 0) out.notes.push(`Mercado Livre: sem resultados para "${q}"`);
    return out;
  },
};
