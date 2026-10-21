import type { ProductDetail } from "@/modules/products/service";
import type { ProductFormValues } from "./product-form";

export function toFormValues(p: ProductDetail): ProductFormValues {
  return {
    name: p.name,
    sku: p.sku,
    brand: p.brand?.name ?? "",
    category: p.category?.name ?? "",
    model: p.model ?? "",
    manufacturerCode: p.manufacturerCode ?? "",
    gtin: p.gtin ?? "",
    unit: p.unit,
    description: p.description ?? "",
    internalNotes: p.internalNotes ?? "",
    tags: p.tags.map((t) => t.name).join(", "),
    specs: p.specs.map((s) => ({ key: s.key, value: s.value, unit: s.unit ?? "" })),
    links: p.links.map((l) => ({ label: l.label ?? "", url: l.url })),
    status: p.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
  };
}
