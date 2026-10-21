import type { Metadata } from "next";
import Link from "next/link";
import { peekInvitation } from "@/modules/tenants/service";
import { ROLE_LABEL } from "@/server/permissions";
import { getSessionUser } from "@/server/tenant-context";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Convite" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const inv = await peekInvitation(token);
  const user = await getSessionUser();
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        {!inv ? (
          <>
            <h1 className="mb-2 text-lg font-semibold">Convite indisponível</h1>
            <p className="text-sm text-slate-600">O link é inválido, expirou ou já foi usado. Peça um novo convite ao administrador.</p>
          </>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold">Convite para {inv.tenantName}</h1>
            <p className="mb-4 text-sm text-slate-600">
              Acesso como <strong>{ROLE_LABEL[inv.role]}</strong> para <strong>{inv.email}</strong>.
            </p>
            {inv.userExists && user?.email !== inv.email ? (
              <p className="text-sm text-slate-700">
                Já existe uma conta com este e-mail. <Link className="underline" href="/login">Entre com ela</Link> e abra este link novamente.
              </p>
            ) : (
              <AcceptForm token={token} needsPassword={!inv.userExists} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
