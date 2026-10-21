"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ListParams } from "@/modules/products/service";
import { bulkUpdateAction } from "../catalogo/actions";

type Opt = { id: string; name: string };

export function BulkPanel({ tenantSlug, filter, total, categories, brands }: { tenantSlug: string; filter: ListParams; total: number; categories: Opt[]; brands: Opt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"category" | "brand" | "addTag" | "status">("category");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) {
    return <button className="text-sm underline" onClick={() => setOpen(true)}>Editar em massa os {total} produto(s) deste filtro…</button>;
  }
  const change =
    kind === "category" ? { kind, categoryId: value } : kind === "brand" ? { kind, brandId: value } : kind === "addTag" ? { kind, tag: value } : { kind, status: (value || "DRAFT") as "DRAFT" | "ACTIVE" };
  return (
    <div className="card flex flex-wrap items-end gap-2 border-amber-300 p-3 text-sm">
      <strong className="w-full">Aplicar aos {total} produto(s) do filtro atual</strong>
      <select className="input w-auto" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setValue(""); }} aria-label="Ação">
        <option value="category">Definir categoria</option>
        <option value="brand">Definir marca</option>
        <option value="addTag">Adicionar tag</option>
        <option value="status">Alterar status</option>
      </select>
      {kind === "category" && <select className="input max-w-80" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Categoria"><option value="">Escolha…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      {kind === "brand" && <select className="input w-56" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Marca"><option value="">Escolha…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
      {kind === "addTag" && <input className="input w-48" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Nome da tag" maxLength={60} aria-label="Tag" />}
      {kind === "status" && <select className="input w-48" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Status"><option value="DRAFT">Rascunho</option><option value="ACTIVE">Ativo (só quem tem marca e modelo)</option></select>}
      <button className="btn-primary" disabled={busy || (kind !== "status" && !value)} onClick={async () => {
        if (!confirm(`Aplicar a ${total} produto(s)? A alteração é auditada.`)) return;
        setBusy(true);
        setMsg(null);
        const r = await bulkUpdateAction(tenantSlug, filter, change, total);
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: `${r.data.updated} alterado(s)${r.data.skipped ? `, ${r.data.skipped} mantido(s) (regra de marca/modelo ou já tinham)` : ""}.` } : { ok: false, text: r.message });
        router.refresh();
      }}>{busy ? "Aplicando…" : "Aplicar"}</button>
      <button className="text-xs underline" onClick={() => setOpen(false)}>fechar</button>
      {msg && <p role="status" className={`w-full ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
