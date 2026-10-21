import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { consumeRateLimit } from "@/server/rate-limit";
import { isAllowed, parseRobots, type RobotsRules } from "./robots";

export const USER_AGENT = process.env.RESEARCH_USER_AGENT || "CITLibraryBot/0.1 (catalogo interno; contato via administrador)";

/** Formatos aceitos pelo pipeline de imagem (sem AVIF/HEIC), na mesma ordem em todas as etapas. */
export const IMAGE_ACCEPT = "image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1";

export class FetchBlocked extends Error {
  constructor(
    message: string,
    readonly reason: "robots" | "ssrf" | "scheme" | "size" | "status" | "type" | "rate" | "timeout",
  ) {
    super(message);
  }
}

/** IP privado, loopback, link-local, CGNAT, multicast ou reservado. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FetchBlocked("Esquema não permitido", "scheme");
  if (url.username || url.password) throw new FetchBlocked("URL com credenciais", "ssrf");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new FetchBlocked(`Destino interno bloqueado: ${host}`, "ssrf");
}

const robotsCache = new Map<string, { rules: RobotsRules; at: number }>();

async function robotsFor(origin: string): Promise<RobotsRules> {
  const c = robotsCache.get(origin);
  if (c && Date.now() - c.at < 3600_000) return c.rules;
  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const r = await rawFetch(new URL("/robots.txt", origin), 512 * 1024, 10_000, "text/plain");
    if (r.status >= 200 && r.status < 300) rules = parseRobots(r.body.toString("utf8"), USER_AGENT.split("/")[0]);
    // 4xx = sem restrições; 5xx = tratar como proibido (RFC 9309).
    else if (r.status >= 500) rules = { allow: [], disallow: ["/"] };
  } catch {
    rules = { allow: [], disallow: ["/"] };
  }
  robotsCache.set(origin, { rules, at: Date.now() });
  return rules;
}

type RawResponse = { status: number; url: string; contentType: string; body: Buffer; headers: Headers };

async function rawFetch(url: URL, maxBytes: number, timeoutMs: number, accept: string): Promise<RawResponse> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(current);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": USER_AGENT, accept, "accept-language": "pt-BR,pt;q=0.9" } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new FetchBlocked("Redirecionamento sem destino", "status");
        current = new URL(loc, current);
        continue;
      }
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > maxBytes) throw new FetchBlocked("Resposta grande demais", "size");
      const chunks: Buffer[] = [];
      let total = 0;
      if (res.body) {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          total += chunk.length;
          if (total > maxBytes) {
            ctrl.abort();
            throw new FetchBlocked("Resposta grande demais", "size");
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      return { status: res.status, url: current.toString(), contentType: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks), headers: res.headers };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new FetchBlocked("Tempo esgotado", "timeout");
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
  throw new FetchBlocked("Redirecionamentos demais", "status");
}

/**
 * GET público com: SSRF bloqueado (também após redirecionamentos), robots.txt,
 * limite de ritmo por domínio (persistente), tamanho e tempo máximos.
 */
export async function politeFetch(urlStr: string, opts: { maxBytes?: number; timeoutMs?: number; accept?: string; respectRobots?: boolean } = {}): Promise<RawResponse> {
  const url = new URL(urlStr);
  if (opts.respectRobots !== false) {
    const rules = await robotsFor(url.origin);
    if (!isAllowed(rules, url.pathname + url.search)) throw new FetchBlocked(`Bloqueado pelo robots.txt de ${url.hostname}`, "robots");
  }
  const perHost = Number(process.env.RESEARCH_HOST_RPM || 20);
  const rl = await consumeRateLimit(`host:${url.hostname}`, 60, perHost);
  if (!rl.allowed) throw new FetchBlocked(`Limite de ritmo para ${url.hostname}`, "rate");
  return rawFetch(url, opts.maxBytes ?? 3 * 1024 * 1024, opts.timeoutMs ?? 20_000, opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8");
}
