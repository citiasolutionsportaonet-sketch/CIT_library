"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelBatchAction, confirmBatchAction } from "../actions";

export function BatchActions({ tenantSlug, batchId }: { tenantSlug: string; batchId: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [updateNames, setUpdateNames] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="card space-y-2 border-amber-300 p-4 text-sm">
      <h2 className="font-semibold">Confirmar importação</h2>
      <ul className="list-disc pl-5 text-slate-600">
        <li>Produtos novos entram como <strong>rascunho</strong>. Produtos ausentes do arquivo <strong>não</strong> são arquivados.</li>
        <li>Campos existentes são preservados; valor vazio nunca apaga dado. Custo zero é tratado como ausente.</li>
        <li>O custo é registrado no histórico (append-only) com a data de vigência abaixo. Reenvio não duplica.</li>
        <li>A aplicação roda no worker (<code>npm run worker</code>); acompanhe nesta página.</li>
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col"><span className="label">Vigência do custo</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={updateNames} onChange={(e) => setUpdateNames(e.target.checked)} /> Atualizar descrição de produtos já existentes</label>
        <button className="btn-primary" disabled={pending || !date} onClick={async () => {
          setPending(true);
          const r = await confirmBatchAction(tenantSlug, batchId, date, updateNames);
          setPending(false);
          setMsg(r.ok ? { ok: true, text: `Confirmado: ${r.data.jobs} job(s) na fila.` } : { ok: false, text: r.fields.effectiveDate ?? r.message });
          router.refresh();
        }}>{pending ? "Confirmando…" : "Confirmar e aplicar"}</button>
        <button className="btn-secondary" disabled={pending} onClick={async () => {
          if (!confirm("Cancelar este lote? Nada foi aplicado ainda.")) return;
          const r = await cancelBatchAction(tenantSlug, batchId);
          if (!r.ok) setMsg({ ok: false, text: r.message });
          router.refresh();
        }}>Cancelar lote</button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.text}</p>}
    </div>
  );
}
