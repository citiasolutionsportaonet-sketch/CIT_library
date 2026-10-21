"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptInviteAction } from "./actions";

export function AcceptForm({ token, needsPassword }: { token: string; needsPassword: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await acceptInviteAction(
      token,
      needsPassword
        ? { name: String(fd.get("name") ?? ""), password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? "") }
        : {},
    );
    if (!res.ok) {
      setPending(false);
      setError(res.message);
      setFields(res.fields);
      return;
    }
    router.replace(res.data.redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {needsPassword && (
        <>
          <div>
            <label className="label" htmlFor="name">Seu nome</label>
            <input id="name" name="name" className="input" required maxLength={120} autoComplete="name" aria-invalid={!!fields.name} />
            {fields.name && <p className="field-error">{fields.name}</p>}
          </div>
          <div>
            <label className="label" htmlFor="password">Senha (mínimo 10 caracteres)</label>
            <input id="password" name="password" type="password" className="input" required minLength={10} maxLength={128} autoComplete="new-password" aria-invalid={!!fields.password} />
            {fields.password && <p className="field-error">{fields.password}</p>}
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirme a senha</label>
            <input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" aria-invalid={!!fields.confirm} />
            {fields.confirm && <p className="field-error">{fields.confirm}</p>}
          </div>
        </>
      )}
      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Confirmando…" : "Aceitar convite"}
      </button>
    </form>
  );
}
