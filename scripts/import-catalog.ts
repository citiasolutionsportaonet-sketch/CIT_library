// Importação por linha de comando (mesmo serviço da tela Importações).
//   Prévia (não altera o catálogo):
//     npm run import:catalog -- --file "imports/iot valores.xlsx" --supplier "Distribuidor" --as email@x
//   Confirmar e enfileirar (o worker aplica):
//     npm run import:catalog -- --confirm <batchId> --effective-date 2026-10-21 --as email@x
//   Dados preliminares de pesquisa (abas do lote 01):
//     npm run import:catalog -- --preliminary imports/CIT_Library_lote_01_imagens.xlsx --as email@x
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { cancelBatch, confirmBatch, createImportBatch, getBatch } from "@/modules/imports/service";
import { importPreliminaryResearch } from "@/modules/research/service";
import { getDb } from "@/server/db";
import type { TenantContext } from "@/server/authorize";
import { permissionsFor } from "@/server/permissions";
import { arg, main } from "./lib/common";

async function ctxFor(email: string): Promise<TenantContext> {
  const slug = process.env.DEFAULT_TENANT_SLUG || "cit";
  const m = await getDb().membership.findFirst({ where: { active: true, tenant: { slug }, user: { email: email.toLowerCase(), active: true } }, include: { tenant: true, user: true } });
  if (!m) throw new Error(`Usuário ${email} não é membro ativo de "${slug}".`);
  return { tenantId: m.tenantId, tenantSlug: slug, tenantName: m.tenant.name, timezone: m.tenant.timezone, userId: m.userId, userName: m.user.name, role: m.role, permissions: permissionsFor(m.role), requestId: `cli:${randomUUID()}` };
}

main(async () => {
  const as = arg("as");
  if (!as) throw new Error("Informe --as <e-mail do usuário responsável>.");
  const ctx = await ctxFor(as);
  const file = arg("file");
  const confirm = arg("confirm");
  const prelim = arg("preliminary");
  const cancel = arg("cancel");
  if (cancel) {
    await cancelBatch(ctx, cancel);
    console.log("✔ Lote cancelado (linhas já aplicadas, se houver, são preservadas).");
  } else if (file) {
    const r = await createImportBatch(ctx, { bytes: new Uint8Array(fs.readFileSync(file)), fileName: file.split("/").pop()!, supplier: arg("supplier") || "Distribuidor", justification: arg("justification") });
    console.log(JSON.stringify({ batchId: r.batchId, prévia: r.counters }, null, 2));
    const warn = await getBatch(ctx, r.batchId, { withWarnings: true });
    console.log(`Linhas com aviso: ${warn.total}. Exemplos:`);
    for (const row of warn.rows.slice(0, 5)) console.log(`  linha ${row.rowNumber}: ${(row.warnings as string[]).join(" | ")}`);
    const bad = await getBatch(ctx, r.batchId, { status: "INVALID" });
    for (const row of bad.rows.slice(0, 5)) console.log(`  INVÁLIDA ${row.rowNumber}: ${(row.errors as string[]).join(" | ")}`);
    console.log(`\nNada foi gravado no catálogo. Para aplicar:\n  npm run import:catalog -- --confirm ${r.batchId} --effective-date AAAA-MM-DD --as ${as}`);
  } else if (confirm) {
    const d = arg("effective-date");
    if (!d) throw new Error("Informe --effective-date AAAA-MM-DD (vigência do custo).");
    const r = await confirmBatch(ctx, confirm, { effectiveDate: d, updateNames: process.argv.includes("--update-names") });
    console.log(`✔ Lote confirmado: ${r.jobs} job(s) na fila, vigência ${r.effectiveAt.toISOString()}. Rode: npm run worker`);
  } else if (prelim) {
    const r = await importPreliminaryResearch(ctx, new Uint8Array(fs.readFileSync(prelim)), new Date());
    console.log(JSON.stringify(r, null, 2));
  } else throw new Error("Use --file, --confirm ou --preliminary.");
});
