// Operação da pesquisa pela linha de comando (mesmo serviço do painel).
//   npm run research -- --skus 4570046,4570045 --providers official-site --max-calls 0 --max-cost 0 --as email@x
//   npm run research -- --limit 100 --providers official-site,brave-search --max-calls 120 --max-cost 6 --as email@x
//   npm run research -- --run <id> --action pause|resume|cancel|retry-failed --as email@x
//   npm run research -- --approve-official-images --as email@x   (coloca na galeria as oficiais verificadas)
//   npm run research -- --approve-assets <id,id> --note "motivo" --as email@x
//   --auto-images: na criação, aprova automaticamente imagens oficiais verificadas
import { randomUUID } from "node:crypto";
import { normalizeCode } from "@/lib/normalize";
import { approveAsset, bulkApproveOfficialImages, controlRun, createRun } from "@/modules/research/service";
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
  const approveIds = arg("approve-assets");
  if (approveIds) {
    const note = arg("note") || undefined;
    for (const id of approveIds.split(",")) {
      await approveAsset(ctx, id.trim(), note);
      console.log(`✔ Evidência ${id.trim()} aprovada`);
    }
    return;
  }
  if (flag("approve-official-images")) {
    console.log("✔ Imagens oficiais:", await bulkApproveOfficialImages(ctx));
    return;
  }
  const runId = arg("run");
  if (runId) {
    const action = arg("action") as "pause" | "resume" | "cancel" | "retry-failed";
    console.log(await controlRun(ctx, runId, action));
    return;
  }
  const skus = arg("skus")?.split(",").map((s) => normalizeCode(s)).filter(Boolean);
  const productIds = skus ? (await getDb().product.findMany({ where: { tenantId: ctx.tenantId, normalizedSku: { in: skus } }, select: { id: true } })).map((p) => p.id) : undefined;
  if (skus && productIds!.length !== skus.length) throw new Error(`Encontrados ${productIds!.length} de ${skus.length} SKUs.`);
  const cents = Math.round(Number(arg("max-cost") ?? "0") * 100);
  const run = await createRun(ctx, {
    name: arg("name") || undefined,
    productIds,
    limit: productIds?.length ?? Number(arg("limit") ?? 10),
    providers: (arg("providers") ?? "official-site").split(","),
    maxApiCalls: Number(arg("max-calls") ?? 0),
    maxCostCents: cents,
    filter: productIds ? undefined : { researchStatus: ["PENDING", "FAILED", "NO_DATA"] },
    autoApproveOfficialImages: flag("auto-images"),
  });
  console.log(`✔ Execução ${run.id} criada com ${run.totalJobs} produto(s). Rode: npm run worker`);
});
