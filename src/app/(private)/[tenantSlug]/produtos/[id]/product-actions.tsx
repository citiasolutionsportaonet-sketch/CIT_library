"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { archiveProductAction, duplicateProductAction } from "../actions";

export function ProductActions({ tenantSlug, id, version, status }: { tenantSlug: string; id: string; version: number; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(archived: boolean) {
    if (pending) return;
    if (archived && !confirm("Arquivar este produto? Ele sai da busca padrão, mas pode ser restaurado.")) return;
    setPending(true);
    const r = await archiveProductAction(tenantSlug, id, version, archived);
    setPending(false);
    if (!r.ok) setError(r.message);
    router.refresh();
  }

  async function duplicate() {
    if (pending) return;
    const sku = prompt("SKU do novo produto (rascunho):");
    if (!sku) return;
    setPending(true);
    const r = await duplicateProductAction(tenantSlug, id, sku);
    setPending(false);
    if (!r.ok) return setError(r.fields.sku ?? r.message);
    router.push(`/${tenantSlug}/produtos/${r.data.id}/editar`);
  }

  return (
    <div className="ml-auto flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {status !== "ARCHIVED" && <Link href={`/${tenantSlug}/produtos/${id}/editar`} className="btn-primary">Editar</Link>}
        <button type="button" className="btn-secondary" disabled={pending} onClick={duplicate}>Duplicar</button>
        {status === "ARCHIVED" ? (
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => archive(false)}>Restaurar</button>
        ) : (
          <button type="button" className="btn-danger" disabled={pending} onClick={() => archive(true)}>Arquivar</button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
