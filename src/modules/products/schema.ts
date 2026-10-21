import { z } from "zod";
import { isValidGtin } from "@/lib/gtin";
import { cleanMultiline, cleanText } from "@/lib/normalize";

// Validação compartilhada: no cliente só melhora a experiência; o servidor
// sempre revalida com este mesmo schema (allowlist de campos).

const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max, `${label}: máximo de ${max} caracteres.`))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const optionalLong = (max: number, label: string) =>
  z
    .string()
    .transform(cleanMultiline)
    .pipe(z.string().max(max, `${label}: máximo de ${max} caracteres.`))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const MAX_SPECS = 100;
export const MAX_SPECS_BYTES = 32 * 1024;
export const MAX_TAGS = 30;
export const MAX_LINKS = 20;

export const specSchema = z.object({
  key: z.string().transform(cleanText).pipe(z.string().min(1, "Informe a característica.").max(120)),
  value: z.string().transform(cleanText).pipe(z.string().min(1, "Informe o valor.").max(500)),
  unit: z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(30))
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const linkSchema = z.object({
  label: z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(120))
    .optional()
    .transform((v) => (v ? v : undefined)),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    }, "Use um link http:// ou https:// válido."),
});

export const productInputSchema = z
  .object({
    name: z.string().transform(cleanText).pipe(z.string().min(1, "Informe o nome.").max(200, "Nome: máximo de 200 caracteres.")),
    sku: z.string().transform(cleanText).pipe(z.string().min(1, "Informe o SKU interno.").max(80, "SKU: máximo de 80 caracteres.")),
    brand: optionalText(120, "Marca"),
    category: optionalText(120, "Categoria"),
    model: optionalText(120, "Modelo"),
    manufacturerCode: optionalText(120, "Código do fabricante"),
    gtin: z
      .string()
      .transform((v) => v.replace(/\s+/g, ""))
      .refine((v) => v === "" || isValidGtin(v), "EAN/GTIN inválido: confira os dígitos (8, 12, 13 ou 14) e o dígito verificador.")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    unit: z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(20, "Unidade: máximo de 20 caracteres."))
      .optional()
      .transform((v) => (v ? v.toUpperCase() : "UN")),
    description: optionalLong(20_000, "Descrição"),
    internalNotes: optionalLong(10_000, "Notas internas"),
    tags: z
      .array(z.string().transform(cleanText).pipe(z.string().min(1).max(60, "Tag: máximo de 60 caracteres.")))
      .max(MAX_TAGS, `Máximo de ${MAX_TAGS} tags.`)
      .default([]),
    specs: z.array(specSchema).max(MAX_SPECS, `Máximo de ${MAX_SPECS} características.`).default([]),
    links: z.array(linkSchema).max(MAX_LINKS, `Máximo de ${MAX_LINKS} links.`).default([]),
    status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
  })
  .superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v.specs)).length > MAX_SPECS_BYTES) {
      ctx.addIssue({ code: "custom", path: ["specs"], message: "Características excedem o tamanho máximo (32 KB)." });
    }
    if (v.manufacturerCode && !v.brand) {
      ctx.addIssue({ code: "custom", path: ["brand"], message: "Informe a marca ao preencher o código do fabricante." });
    }
    if (v.status === "ACTIVE") {
      if (!v.brand) ctx.addIssue({ code: "custom", path: ["brand"], message: "Para ativar, informe a marca." });
      if (!v.model) ctx.addIssue({ code: "custom", path: ["model"], message: "Para ativar, informe o modelo." });
    }
  });

export type ProductInput = z.output<typeof productInputSchema>;
export type ProductInputRaw = z.input<typeof productInputSchema>;
export type Spec = z.output<typeof specSchema>;
export type Link = z.output<typeof linkSchema>;

/** Converte issues do Zod em { campo: mensagem } (primeira mensagem por campo). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
