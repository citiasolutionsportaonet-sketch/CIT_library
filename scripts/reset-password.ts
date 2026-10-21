// Recuperação de senha sem SMTP: comando local, auditado, senha lida sem eco.
// Revoga todas as sessões do usuário.
import { normalizeEmail } from "@/lib/normalize";
import { setUserPassword } from "@/modules/auth/users";
import { audit } from "@/server/audit";
import { writeTx } from "@/server/maintenance";
import { ask, askHidden, main } from "./lib/common";
import os from "node:os";

main(async () => {
  const email = normalizeEmail(await ask("E-mail do usuário: "));
  const password = await askHidden("Nova senha (mín. 10 caracteres): ");
  if (password !== (await askHidden("Confirme a nova senha: "))) throw new Error("As senhas não conferem.");
  await writeTx(async (tx) => {
    const user = await tx.user.findUnique({ where: { email }, include: { memberships: { select: { tenantId: true } } } });
    if (!user) throw new Error("Usuário não encontrado.");
    await setUserPassword(tx, user.id, password);
    for (const m of user.memberships) {
      await audit(tx, { tenantId: m.tenantId, actorId: null, requestId: `cli:${os.userInfo().username}`, action: "user.password_reset_cli", entityType: "User", entityId: user.id, diff: { email } });
    }
  });
  console.log("✔ Senha redefinida e sessões revogadas.");
});
