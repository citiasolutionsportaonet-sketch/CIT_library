// Política de normalização (registrada em docs/decisoes.md):
// - Todo texto: Unicode NFC + trim + espaços internos colapsados.
// - Códigos (SKU, código do fabricante): NFKC, maiúsculas, sem espaços nas
//   bordas, espaços internos colapsados. Continuam strings: zeros à esquerda
//   são preservados e nada é convertido para número.
// - Nomes para deduplicação (marca, categoria, tag): minúsculas, sem acentos.

export function cleanText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function cleanMultiline(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

export function normalizeCode(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeEmail(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

export function slugify(value: string): string {
  return normalizeName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
