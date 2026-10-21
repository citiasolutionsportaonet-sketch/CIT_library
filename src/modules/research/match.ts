// Correspondência produto × anúncio. Conservadora: na dúvida, fica para revisão.
import { normalizeName } from "@/lib/normalize";

export const tokens = (s: string) => normalizeName(s).split(/[^a-z0-9]+/).filter(Boolean);

const COLORS = new Set(["preto", "preta", "branco", "branca", "cinza", "azul", "vermelho", "vm", "az", "pr", "br", "bco", "pto"]);
const EXCLUDE = ["kit", "kits", "peca", "pecas", "placa", "placas", "suporte", "capa", "case", "usado", "usada", "recondicionado", "recondicionada", "defeito", "reparo", "compativel", "similar", "generico", "replica", "refil", "bateria", "fonte", "cabo", "adaptador", "conector", "pelicula", "manual", "sucata"];

/**
 * Sugere o modelo a partir da descrição: tokens com dígitos e os vizinhos
 * imediatos curtos em maiúsculas (ex.: "VIP 1230 D G5"). É só uma sugestão.
 */
// Palavras descritivas em maiúsculas que não fazem parte do código do modelo.
const NOT_MODEL = new Set(["SENSOR", "MODULO", "MÓDULO", "COM", "SEM", "PARA", "DE", "DA", "DO", "E", "C", "S", "P", "KIT", "UN", "CAMERA", "CÂMERA", "CABO", "PLACA", "FONTE", "BATERIA", "CENTRAL", "TELEFONE", "SWITCH", "ROTEADOR", "LICENCA", "LICENÇA", "LIC", "RML", "RAMAL", "RAMAIS", "MESES", "PRETO", "BRANCO", "CINZA", "AZUL", "PRETA", "BRANCA", "BR", "PT", "PTO", "BCO", "EXPOSITOR", "SUPORTE", "CONVERSOR", "INTERRUPTOR", "ADAPTADOR", "DIGITAL", "SMART", "MINI", "IP", "A", "RAM", "GB", "TB", "QUE", "MAIOR", "MENOR", "ATE", "ATÉ", "ACIMA", "CAT", "CANAIS", "ANUAL", "MENSAL"]);
// Medidas e capacidades (ex.: 24V, 4000MAH, 8GB, 2MP, 120KVA, 3.6MM, 305M).
const UNIT = /^\d+([.,]\d+)?(V|VCC|VAC|A|AH|MAH|W|KW|KVA|VA|GB|TB|MB|MP|MM|CM|M|MHZ|GHZ|HZ|P|X|PCS|UN|POL|DB|FPS)$/i;
// Sufixos curtos que costumam integrar o modelo (ex.: VIP 1230 B G5, XPE 3101 IP).
const KEEP_SHORT = new Set(["IP", "IA", "FT", "FC", "G2", "G3", "G4", "G5", "PRO", "PLUS", "MAX", "LITE", "BIO", "AX", "AC", "POE", "D", "B", "F", "Z", "W", "S", "L", "R", "X", "ID"]);

/**
 * Sugere o modelo a partir da descrição: o maior trecho em torno de um token
 * com dígitos, com prefixo alfabético curto (ex.: "VIP", "XPE") e sufixos de
 * modelo. Descarta medidas, cores e palavras descritivas. É só sugestão.
 */
export function guessModel(description: string): string | null {
  const parts = description.replace(/[,;()|]/g, " ").split(/\s+/).filter(Boolean);
  const isCore = (p: string) => /\d/.test(p) && !UNIT.test(p) && !/^CAT\.?\d+E?$/i.test(p) && /^[A-Z0-9][A-Z0-9.+-]*$/i.test(p) && p.length <= 32;
  const isPrefix = (p: string) => /^[A-Z]{2,5}\+?$/.test(p) && !NOT_MODEL.has(p.toUpperCase());
  const isSuffix = (p: string) => isCore(p) || KEEP_SHORT.has(p.toUpperCase().replace(/\+$/, ""));
  let best: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!isCore(parts[i])) continue;
    let s = i;
    let e = i;
    if (s > 0 && isPrefix(parts[s - 1])) s--;
    while (e + 1 < parts.length && isSuffix(parts[e + 1]) && e - i < 4) e++;
    const run = parts.slice(s, e + 1);
    // Prefere trecho com prefixo alfabético e mais longo.
    const score = (r: string[]) => r.join(" ").length + (/^[A-Z]/i.test(r[0]) ? 10 : 0);
    if (score(run) > score(best)) best = run;
    i = e;
  }
  const m = best.join(" ").trim();
  return m.length >= 3 && /[A-Z]/i.test(m) ? m.slice(0, 120) : null;
}

export type MatchInput = { model: string | null; description: string; brand: string | null };
export type MatchResult = { score: number; accept: boolean; reasons: string[] };

/** Pontua um anúncio. Aceite automático só com correspondência estrita. */
export function scoreOffer(title: string, p: MatchInput, condition: "NEW" | "USED" | "REFURBISHED" | "UNKNOWN"): MatchResult {
  const t = new Set(tokens(title));
  const reasons: string[] = [];
  const modelTokens = tokens(p.model ?? guessModel(p.description) ?? "").filter((x) => !COLORS.has(x));
  if (modelTokens.length === 0) return { score: 0, accept: false, reasons: ["modelo desconhecido: revisar manualmente"] };
  const found = modelTokens.filter((x) => t.has(x));
  let score = Math.round((found.length / modelTokens.length) * 60);
  if (found.length === modelTokens.length) reasons.push("todos os termos do modelo presentes");
  else reasons.push(`faltam termos do modelo: ${modelTokens.filter((x) => !t.has(x)).join(", ")}`);
  if (p.brand && tokens(p.brand).every((b) => t.has(b))) {
    score += 20;
    reasons.push("marca presente");
  }
  const bad = EXCLUDE.filter((w) => t.has(w));
  if (bad.length) reasons.push(`termos de exclusão: ${bad.join(", ")}`);
  if (condition === "NEW") score += 20;
  else reasons.push(`condição ${condition.toLowerCase()}`);
  const accept = found.length === modelTokens.length && modelTokens.some((x) => /\d/.test(x)) && bad.length === 0 && condition === "NEW" && (!p.brand || reasons.includes("marca presente"));
  return { score: bad.length ? Math.min(score, 30) : score, accept, reasons };
}

/**
 * A imagem corresponde ao modelo? Exige todos os termos COM DÍGITO do modelo
 * (ex.: "1230", "g5") nos textos da imagem (título, página, nome do arquivo).
 * Termos só alfabéticos (ex.: "vip", "b") ajudam, mas não bastam.
 */
export function imageMatchesModel(model: string | null, texts: (string | null | undefined)[]): boolean {
  if (!model) return false;
  const want = tokens(model).filter((t) => /\d/.test(t));
  if (want.length === 0) return false;
  const have = new Set(texts.flatMap((t) => tokens(decodeURIComponentSafe(t ?? ""))));
  // Também aceita o código colado (ex.: "vip1230bg5" no nome do arquivo).
  const glued = texts.map((t) => normalizeName(decodeURIComponentSafe(t ?? "")).replace(/[^a-z0-9]/g, "")).join(" ");
  const compact = tokens(model).join("");
  return want.every((w) => have.has(w)) || (compact.length >= 5 && glued.includes(compact));
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
