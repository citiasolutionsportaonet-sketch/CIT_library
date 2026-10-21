// Seed idempotente. Não cria usuários, senhas nem produtos (use npm run bootstrap).
// Apenas garante a marca "Intelbras" na organização padrão, se ela existir.
import "dotenv/config";
import { normalizeName } from "@/lib/normalize";
import { getDb } from "@/server/db";

async function main() {
  const db = getDb();
  const slug = process.env.DEFAULT_TENANT_SLUG || "cit";
  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.log(`Organização "${slug}" não existe ainda; rode npm run bootstrap. Nada a semear.`);
    return;
  }
  await db.brand.upsert({
    where: { tenantId_normalizedName: { tenantId: tenant.id, normalizedName: normalizeName("Intelbras") } },
    create: { tenantId: tenant.id, name: "Intelbras", normalizedName: normalizeName("Intelbras") },
    update: {},
  });
  console.log("✔ Marca Intelbras garantida (nenhum produto criado).");
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
