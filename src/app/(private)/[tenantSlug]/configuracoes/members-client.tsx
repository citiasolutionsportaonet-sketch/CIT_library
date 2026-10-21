"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changeRoleAction, inviteAction, revokeInviteAction, setActiveAction } from "./actions";

const LABEL: Record<string, string> = { OWNER: "Proprietário", ADMIN: "Administrador", EDITOR: "Editor", VIEWER: "Leitor" };

export function InviteForm({ tenantSlug, roles }: { tenantSlug: string; roles: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending) return;
          const fd = new FormData(e.currentTarget);
          setPending(true);
          setError(null);
          setLink(null);
          const r = await inviteAction(tenantSlug, String(fd.get("email")), String(fd.get("role")));
          setPending(false);
          if (!r.ok) return setError(r.fields.email ?? r.message);
          setLink(r.data.link);
          (e.target as HTMLFormElement).reset();
          router.refresh();
        }}
      >
        <div>
          <label className="label" htmlFor="inv-email">E-mail</label>
          <input id="inv-email" name="email" type="email" required className="input w-72" />
        </div>
        <div>
          <label className="label" htmlFor="inv-role">Papel</label>
          <select id="inv-role" name="role" className="input" defaultValue="EDITOR">
            {roles.map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}
          </select>
        </div>
        <button className="btn-primary" disabled={pending}>{pending ? "Gerando…" : "Gerar convite"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {link && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-medium">Link do convite (segredo — mostrado somente agora):</p>
          <code className="block break-all rounded bg-white p-2 text-xs" data-testid="invite-link">{link}</code>
          <button type="button" className="btn-secondary mt-2" onClick={() => navigator.clipboard?.writeText(link)}>Copiar</button>
        </div>
      )}
    </div>
  );
}

export function MemberControls({ tenantSlug, membershipId, role, active, assignable }: { tenantSlug: string; membershipId: string; role: string; active: boolean; assignable: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) setError(r.message ?? "Falha.");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-1" aria-label="Papel" value={role} disabled={pending} onChange={(e) => run(() => changeRoleAction(tenantSlug, membershipId, e.target.value))}>
        {assignable.map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}
      </select>
      <button type="button" className={active ? "btn-danger py-1" : "btn-secondary py-1"} disabled={pending}
        onClick={() => {
          if (!active || confirm("Desativar o acesso desta pessoa à organização?")) void run(() => setActiveAction(tenantSlug, membershipId, !active));
        }}>
        {active ? "Desativar" : "Reativar"}
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

export function RevokeInvite({ tenantSlug, id }: { tenantSlug: string; id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button type="button" className="text-xs text-red-700 underline" disabled={pending}
      onClick={async () => {
        setPending(true);
        await revokeInviteAction(tenantSlug, id);
        setPending(false);
        router.refresh();
      }}>
      revogar
    </button>
  );
}
