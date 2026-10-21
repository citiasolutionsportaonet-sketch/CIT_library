import { z } from "zod";

const count = z.number().int().nonnegative();
export const showcaseSchema = z.object({
  organization: z.string(),
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable(),
  stats: z.object({
    total: count,
    withPhoto: count,
    withPrice: count,
    withBrand: count,
    withModel: count,
    active: count,
    drafts: count,
  }),
  categories: z.array(z.object({ id: z.string(), name: z.string(), count })),
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  products: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      name: z.string(),
      brand: z.string().nullable(),
      brandId: z.string().nullable(),
      category: z.string().nullable(),
      categoryId: z.string().nullable(),
      model: z.string().nullable(),
      price: z
        .string()
        .regex(/^\d+\.\d{2}$/)
        .nullable(),
      image: z.string().nullable(),
      status: z.enum(["DRAFT", "ACTIVE"]),
      updatedAt: z.string().datetime(),
    }),
  ),
  total: count,
  page: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  filters: z.object({
    q: z.string(),
    category: z.string(),
    brand: z.string(),
    photo: z.boolean(),
    sort: z.enum(["destaques", "nome", "recentes"]),
  }),
});
export type ShowcaseData = z.infer<typeof showcaseSchema>;
