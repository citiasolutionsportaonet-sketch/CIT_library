"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptSuggestionAction } from "../../catalogo/actions";

export function Suggestions({ tenantSlug, productId, model, manufacturer }: { tenantSlug: string; productId: string; model: string | null; manufacturer: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = async (field: "model" | "manufacturer") => {
    setBusy(true);
    setErr(null);
    const r = await acceptSuggestionAction(tenantSlug, productId, field);
    setBusy(false);
    if (!r.ok) setErr(r.message);
    router.refresh();
  };
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
      <p className="mb-1 font-medium">Sugestões (confira antes de aceitar)</p>
      {model && <p>Modelo sugerido: <strong>{model}</strong> <button className="btn-secondary ml-2 px-2 py-0.5 text-xs" disabled={busy} onClick={() => accept("model")}>Usar como modelo</button></p>}
      {manufacturer && <p className="mt-1">Fabricante sugerido: <strong>{manufacturer}</strong> <button className="btn-secondary ml-2 px-2 py-0.5 text-xs" disabled={busy} onClick={() => accept("manufacturer")}>Usar como marca</button></p>}
      {err && <p role="alert" className="text-red-700">{err}</p>}
    </div>
  );
}
