// Primeiro uso: cria a organização e o primeiro OWNER. Interativo; a senha
// não aparece na tela, não é aceita por argumento e não vai para o histórico.
// Se a organização já tem proprietário, nada é alterado.
import { bootstrapOwner } from "@/modules/tenants/service";
import { ask, askHidden, main } from "./lib/common";

main(async () => {
  const slug = process.env.DEFAULT_TENANT_SLUG || "cit";
  console.log("CIT Library · criação inicial\n");
  const tenantName = (await ask("Nome da organização [CIT]: ")) || "CIT";
  const name = await ask("Nome do administrador: ");
  const email = await ask("E-mail do administrador: ");
  const password = await askHidden("Senha (mín. 10 caracteres): ");
  const confirm = await askHidden("Confirme a senha: ");
  if (password !== confirm) throw new Error("As senhas não conferem.");
  const res = await bootstrapOwner({ tenantName, tenantSlug: slug, name, email, password });
  if (res.status === "exists") {
    console.log(`\nA organização "${res.tenantSlug}" já tem proprietário ativo. Nada foi alterado.`);
    return;
  }
  console.log(`\n✔ Organização "${res.tenantSlug}" pronta com proprietário ${email}${res.reusedUser ? " (usuário existente; senha mantida)" : ""}.`);
  console.log(`  Acesse ${process.env.APP_ORIGIN ?? "http://localhost:3000"}/login`);
});
