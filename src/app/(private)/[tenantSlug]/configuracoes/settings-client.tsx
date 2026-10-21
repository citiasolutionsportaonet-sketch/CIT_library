"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createApiCredentialAction, revokeApiCredentialAction, updateMarkupAction } from "./actions";

export function MarkupForm({ tenantSlug, currentPercent }: { tenantSlug: string; currentPercent: string }) {
  const router = useRouter();
  const [value, setValue] = useState(Number(currentPercent));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const r = await updateMarkupAction(tenantSlug, String(value));
        setPending(false);
        setMsg(r.ok ? { ok: true, text: "Markup atualizado. Os preços CIT foram recalculados." } : { ok: false, text: r.fields.markup ?? r.message });
        router.refresh();
      }}
    >
      <label htmlFor="markup" className="label mb-0">Markup sobre custo</label>
      <input id="markup" type="range" min={0} max={45} step={0.5} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-56" />
      <input type="number" min={0} max={45} step={0.5} value={value} onChange={(e) => setValue(Number(e.target.value))} className="input w-24" aria-label="Markup em %" />
      <span>%</span>
      <span className="text-slate-500">Ex.: custo R$ 100,00 → Preço CIT R$ {(100 * (1 + value / 100)).toFixed(2).replace(".", ",")}</span>
      <button className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button>
      {msg && <span role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.text}</span>}
    </form>
  );
}

type Cred = { id: string; name: string; prefix: string; scopes: string[]; expiresAt: string | null; revoked: boolean; lastUsedAt: string | null };

export function ApiCredentials({ tenantSlug, scopes, items }: { tenantSlug: string; scopes: { id: string; label: string }[]; items: Cred[] }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setPending(true);
          setError(null);
          setToken(null);
          const r = await createApiCredentialAction(tenantSlug, String(fd.get("name")), fd.getAll("scope").map(String), fd.get("days") ? Number(fd.get("days")) : null);
          setPending(false);
          if (!r.ok) return setError(Object.values(r.fields)[0] ?? r.message);
          setToken(r.data.token);
          (e.target as HTMLFormElement).reset();
          router.refresh();
        }}
      >
        <label className="flex flex-col"><span className="label">Sistema</span><input name="name" className="input w-56" placeholder="CIT Projects" required maxLength={80} /></label>
        <fieldset className="flex flex-col">
          <legend className="label">Escopos</legend>
          {scopes.map((s) => (
            <label key={s.id} className="flex items-center gap-1">
              <input type="checkbox" name="scope" value={s.id} defaultChecked={s.id === "catalog:read"} disabled={s.id === "catalog:read"} />
              {s.id === "catalog:read" && <input type="hidden" name="scope" value="catalog:read" />}
              <code>{s.id}</code> — {s.label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col"><span className="label">Validade (dias, opcional)</span><input name="days" type="number" min={1} max={730} className="input w-28" /></label>
        <button className="btn-primary" disabled={pending}>{pending ? "Gerando…" : "Gerar credencial"}</button>
      </form>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {token && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <p className="font-medium">Segredo da credencial (mostrado só agora — guarde no cofre do outro sistema):</p>
          <code className="block break-all rounded bg-white p-2 text-xs">{token}</code>
          <button type="button" className="btn-secondary mt-2" onClick={() => navigator.clipboard?.writeText(token)}>Copiar</button>
        </div>
      )}
      {items.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500"><tr><th>Sistema</th><th>Prefixo</th><th>Escopos</th><th>Validade</th><th>Último uso</th><th></th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-1">{c.name}</td>
                <td className="font-mono">cit_{c.prefix}_…</td>
                <td>{c.scopes.join(", ")}</td>
                <td>{c.revoked ? "revogada" : c.expiresAt ?? "sem expiração"}</td>
                <td>{c.lastUsedAt ?? "nunca"}</td>
                <td>{!c.revoked && <button className="text-red-700 underline" onClick={async () => { if (confirm(`Revogar a credencial de ${c.name}? O sistema perde acesso imediatamente.`)) { await revokeApiCredentialAction(tenantSlug, c.id); router.refresh(); } }}>revogar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
