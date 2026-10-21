export function formatDateTime(date: Date | string, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(date));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABEL = { DRAFT: "Rascunho", ACTIVE: "Ativo", ARCHIVED: "Arquivado" } as const;
