"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

type Opt = { id: string; name: string };

export function CatalogFilters({ facets }: { facets: { brands: Opt[]; categories: Opt[]; tags: Opt[] } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [isPending, startTransition] = useTransition();
  const first = useRef(true);

  function update(changes: Record<string, string | null>) {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    u.delete("pagina");
    const s = u.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  // Busca com debounce de 300 ms; o estado fica na URL.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => update({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const select = (name: string, label: string, opts: Opt[], noneLabel?: string) => (
    <label className="text-sm">
      <span className="sr-only">{label}</span>
      <select className="input max-w-72" value={sp.get(name) ?? ""} onChange={(e) => update({ [name]: e.target.value || null })}>
        <option value="">{label}: todas</option>
        {noneLabel && <option value="none">{noneLabel}</option>}
        {opts.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card flex flex-wrap items-center gap-2 p-3" aria-busy={isPending}>
      <input
        type="search"
        className="input min-w-56 flex-1"
        placeholder="Buscar por nome, SKU, modelo ou código do fabricante"
        aria-label="Buscar produtos"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={120}
      />
      {select("marca", "Marca", facets.brands, "Sem marca")}
      {select("categoria", "Categoria", facets.categories, "Sem categoria")}
      {select("tag", "Tag", facets.tags)}
      <select className="input w-auto" aria-label="Status" value={sp.get("status") ?? ""} onChange={(e) => update({ status: e.target.value || null })}>
        <option value="">Status: não arquivados</option>
        <option value="DRAFT">Rascunho</option>
        <option value="ACTIVE">Ativo</option>
        <option value="ARCHIVED">Arquivado</option>
        <option value="ALL">Todos</option>
      </select>
      <select className="input w-auto" aria-label="Pesquisa" value={sp.get("pesquisa") ?? ""} onChange={(e) => update({ pesquisa: e.target.value || null })}>
        <option value="">Pesquisa: todas</option>
        <option value="PENDING">Não pesquisados</option>
        <option value="NEEDS_REVIEW">Aguardando aprovação</option>
        <option value="ENRICHED">Enriquecidos</option>
        <option value="NO_DATA">Sem dados encontrados</option>
        <option value="FAILED">Com erro</option>
      </select>
      <select className="input w-auto" aria-label="Ordenação" value={sp.get("ordem") ?? "recentes"} onChange={(e) => update({ ordem: e.target.value === "recentes" ? null : e.target.value })}>
        <option value="recentes">Mais recentes</option>
        <option value="nome">Nome</option>
        <option value="sku">SKU</option>
      </select>
      <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm" role="group" aria-label="Visualização">
        <button type="button" className={`px-3 py-2 ${sp.get("vista") !== "tabela" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => update({ vista: null })}>Grade</button>
        <button type="button" className={`px-3 py-2 ${sp.get("vista") === "tabela" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => update({ vista: "tabela" })}>Tabela</button>
      </div>
    </div>
  );
}
