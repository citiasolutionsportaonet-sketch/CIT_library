// Aplica a organização proposta (mesmo serviço da tela Organizar).
//   npm run catalog:organize -- --categories all --brands all --models --as email@x
//   npm run catalog:organize -- --preview --as email@x
import { randomUUID } from "node:crypto";
import { applyBrandProposals, applyCategoryProposals, classificationPreview, fillSuggestedModels } from "@/modules/catalog/service";
import type { TenantContext } from "@/server/authorize";
import { getDb } from "@/server/db";
import { permissionsFor } from "@/server/permissions";
import { arg, flag, main } from "./lib/common";

main(async () => {
  const email = arg("as");
  if (!email) throw new Error("Informe --as <e-mail>.");
  const slug = process.env.DEFAULT_TENANT_SLUG || "cit";
  const m = await getDb().membership.findFirst({ where: { active: true, tenant: { slug }, user: { email: email.toLowerCase(), active: true } }, include: { tenant: true, user: true } });
  if (!m) throw new Error(`Usuário ${email} não é membro ativo.`);
  const ctx: TenantContext = { tenantId: m.tenantId, tenantSlug: slug, tenantName: m.tenant.name, timezone: m.tenant.timezone, userId: m.userId, userName: m.user.name, role: m.role, permissions: permissionsFor(m.role), requestId: `cli:${randomUUID()}` };
  const prev = await classificationPreview(ctx);
  if (flag("preview")) {
    console.log(JSON.stringify({ categorias: prev.categories.map((c) => [c.path, c.count]), semRegra: prev.unmatched.count, marcas: prev.brands.map((b) => [b.brand, b.count]) }, null, 2));
    return;
  }
  const cats = arg("categories");
  if (cats) {
    const paths = cats === "all" ? prev.categories.map((c) => c.path) : cats.split("|");
    console.log("✔ Categorias:", await applyCategoryProposals(ctx, paths));
  }
  const brands = arg("brands");
  if (brands) {
    const names = brands === "all" ? prev.brands.map((b) => b.brand) : brands.split(",");
    console.log("✔ Marcas:", await applyBrandProposals(ctx, names));
  }
  if (flag("models")) console.log("✔ Modelos sugeridos:", await fillSuggestedModels(ctx));
  if (flag("models-recompute")) console.log("✔ Modelos sugeridos (recalculados):", await fillSuggestedModels(ctx, { recompute: true }));
});
