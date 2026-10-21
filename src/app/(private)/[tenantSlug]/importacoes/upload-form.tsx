"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UploadForm({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        const file = fd.get("file") as File | null;
        if (!file || file.size === 0) return setError("Selecione um arquivo .xlsx.");
        setPending(true);
        setError(null);
        const res = await fetch(`/api/t/${encodeURIComponent(tenantSlug)}/imports`, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-supplier": encodeURIComponent(String(fd.get("supplier") ?? "")),
            "x-justification": encodeURIComponent(String(fd.get("justification") ?? "")),
          },
          body: file,
        });
        const j = await res.json().catch(() => null);
        setPending(false);
        if (!res.ok) {
          setError(j?.error?.fields?.file ?? j?.error?.message ?? "Falha no envio.");
          setPrevious(j?.error?.fields?.previousBatchId ?? null);
          return;
        }
        router.push(`/${tenantSlug}/importacoes/${j.data.batchId}`);
      }}
    >
      <label className="flex flex-col text-sm"><span className="label">Arquivo</span><input type="file" name="file" accept=".xlsx" className="text-sm" required /></label>
      <label className="flex flex-col text-sm"><span className="label">Fornecedor</span><input name="supplier" className="input w-64" defaultValue="Distribuidor" required maxLength={120} /></label>
      <label className="flex flex-col text-sm"><span className="label">Justificativa (só para reenviar o mesmo arquivo)</span><input name="justification" className="input w-72" maxLength={300} /></label>
      <button className="btn-primary" disabled={pending}>{pending ? "Lendo planilha…" : "Gerar prévia"}</button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error} {previous && <a className="underline" href={`/${tenantSlug}/importacoes/${previous}`}>Abrir lote anterior</a>}
        </p>
      )}
    </form>
  );
}
