"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { approveOfficialImagesAction, controlRunAction, createRunAction } from "./actions";

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <p className="text-xs text-slate-500" aria-live="polite">Atualizando a cada {seconds}s enquanto há execução ativa.</p>;
}

type Prov = { id: string; label: string; paid: boolean; configured: boolean; costPerCallCents: number };

export function NewRunForm({ tenantSlug, providers }: { tenantSlug: string; providers: Prov[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(providers.filter((p) => p.configured).map((p) => p.id));
  const [limit, setLimit] = useState(10);
  const [maxCalls, setMaxCalls] = useState(30);
  const [maxCost, setMaxCost] = useState("5,00");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const paidSelected = providers.filter((p) => p.paid && selected.includes(p.id));
  const estimate = paidSelected.reduce((a, p) => a + p.costPerCallCents, 0) * limit;
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        if (paidSelected.length && !confirm(`Esta execução pode gastar até R$ ${maxCost} em APIs pagas (estimativa ${(estimate / 100).toFixed(2).replace(".", ",")}). Confirmar?`)) return;
        setPending(true);
        setMsg(null);
        const r = await createRunAction(tenantSlug, {
          name: String(fd.get("name") ?? ""),
          limit,
          providers: selected,
          maxApiCalls: maxCalls,
          maxCostReais: maxCost,
          onlyPending: fd.get("onlyPending") === "on",
          onlyWithCost: fd.get("onlyWithCost") === "on",
          autoApproveOfficialImages: fd.get("autoImages") === "on",
        });
        setPending(false);
        setMsg(r.ok ? { ok: true, text: `Execução criada com ${r.data.jobs} produto(s). Mantenha o worker rodando (npm run worker).` } : { ok: false, text: Object.values(r.fields)[0] ?? r.message });
        router.refresh();
      }}
    >
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col"><span className="label">Nome</span><input name="name" className="input w-64" placeholder="Ex.: Etapa B — 10 produtos" maxLength={120} /></label>
        <label className="flex flex-col"><span className="label">Quantidade de produtos</span><input type="number" min={1} max={5000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="input w-32" /></label>
        <label className="flex flex-col"><span className="label">Máx. chamadas pagas</span><input type="number" min={0} max={100000} value={maxCalls} onChange={(e) => setMaxCalls(Number(e.target.value))} className="input w-36" /></label>
        <label className="flex flex-col"><span className="label">Teto de custo (R$)</span><input value={maxCost} onChange={(e) => setMaxCost(e.target.value)} className="input w-32" inputMode="decimal" /></label>
      </div>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="label">Provedores</legend>
        {providers.map((p) => (
          <label key={p.id} className={`flex items-center gap-1 ${p.configured ? "" : "text-slate-400"}`}>
            <input type="checkbox" disabled={!p.configured} checked={selected.includes(p.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
            {p.label}{p.configured ? "" : " (sem credencial)"}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1"><input type="checkbox" name="onlyPending" defaultChecked /> Só não pesquisados / com erro / sem dados</label>
        <label className="flex items-center gap-1"><input type="checkbox" name="onlyWithCost" /> Só produtos com custo</label>
        <label className="flex items-center gap-1"><input type="checkbox" name="autoImages" defaultChecked /> Colocar automaticamente nos produtos as imagens <strong>oficiais</strong> verificadas (até 3; revendedor nunca)</label>
      </div>
      <p className="text-xs text-slate-500">
        Estimativa máxima de custo: R$ {(estimate / 100).toFixed(2).replace(".", ",")}. A execução pausa sozinha ao atingir o teto de chamadas ou de custo.
      </p>
      <button className="btn-primary" disabled={pending || selected.length === 0}>{pending ? "Criando…" : "Iniciar execução"}</button>
      {msg && <p role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.text}</p>}
    </form>
  );
}

export function RunControls({ tenantSlug, runId, status, failed }: { tenantSlug: string; runId: string; status: string; failed: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (a: "pause" | "resume" | "cancel" | "retry-failed") => {
    if (a === "cancel" && !confirm("Cancelar? Produtos já pesquisados são mantidos; os da fila voltam a 'não pesquisado'.")) return;
    setPending(true);
    setErr(null);
    const r = await controlRunAction(tenantSlug, runId, a);
    setPending(false);
    if (!r.ok) setErr(r.message);
    router.refresh();
  };
  return (
    <span className="ml-auto flex flex-wrap items-center gap-1">
      {status === "RUNNING" && <button className="btn-secondary px-2 py-0.5 text-xs" disabled={pending} onClick={() => act("pause")}>Pausar</button>}
      {status === "PAUSED" && <button className="btn-secondary px-2 py-0.5 text-xs" disabled={pending} onClick={() => act("resume")}>Retomar</button>}
      {(status === "RUNNING" || status === "PAUSED") && <button className="btn-danger px-2 py-0.5 text-xs" disabled={pending} onClick={() => act("cancel")}>Cancelar</button>}
      {failed > 0 && status !== "CANCELED" && <button className="btn-secondary px-2 py-0.5 text-xs" disabled={pending} onClick={() => act("retry-failed")}>Reexecutar falhas ({failed})</button>}
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function ApproveOfficialImages({ tenantSlug, pending }: { tenantSlug: string; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button className="btn-primary" disabled={busy || pending === 0} onClick={async () => {
        if (!confirm("Colocar na galeria dos produtos as imagens oficiais já verificadas (até 3 por produto)?")) return;
        setBusy(true);
        setMsg(null);
        const r = await approveOfficialImagesAction(tenantSlug);
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: `${r.data.approved} imagem(ns) colocada(s) em ${r.data.products} produto(s).${r.data.notes.length ? ` Avisos: ${r.data.notes.join(" | ")}` : ""}` } : { ok: false, text: r.message });
        router.refresh();
      }}>{busy ? "Processando imagens…" : `Colocar imagens oficiais verificadas nos produtos (${pending})`}</button>
      {msg && <span role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.text}</span>}
    </div>
  );
}
