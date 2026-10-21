"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { applyBrandsAction, applyCategoriesAction, deleteTaxonomyAction, fillModelsAction, saveBrandAction, saveCategoryAction, setActiveAction } from "./actions";

type Sample = { sku: string; name: string };

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string; fields: Record<string, string> }>, ok: (d: T) => string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: ok(r.data) } : { ok: false, text: Object.values(r.fields)[0] ?? r.message });
    router.refresh();
  };
  const Msg = () => (msg ? <p role="status" className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p> : null);
  return { busy, run, Msg };
}

export function CategoryProposals({ tenantSlug, groups }: { tenantSlug: string; groups: { path: string; count: number; samples: Sample[] }[] }) {
  const [sel, setSel] = useState<string[]>(groups.map((g) => g.path));
  const { busy, run, Msg } = useRun();
  if (groups.length === 0) return <p className="text-sm text-slate-500">Nenhuma proposta pendente: todos os produtos com regra já têm categoria.</p>;
  const total = groups.filter((g) => sel.includes(g.path)).reduce((a, g) => a + g.count, 0);
  return (
    <div className="space-y-2">
      <ul className="divide-y text-sm">
        {groups.map((g) => (
          <li key={g.path} className="py-1.5">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sel.includes(g.path)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, g.path] : s.filter((x) => x !== g.path)))} />
              <span className="font-medium">{g.path}</span>
              <span className="text-slate-500">{g.count}</span>
            </label>
            <details className="ml-6 text-xs text-slate-600">
              <summary className="cursor-pointer">amostras</summary>
              <ul>{g.samples.map((s) => <li key={s.sku}><span className="font-mono">{s.sku}</span> {s.name}</li>)}</ul>
            </details>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || sel.length === 0} onClick={() => {
          if (confirm(`Aplicar ${sel.length} categoria(s) a ${total} produto(s) sem categoria?`)) void run(() => applyCategoriesAction(tenantSlug, sel), (d) => `${d.updated} produto(s) classificados.`);
        }}>{busy ? "Aplicando…" : `Aplicar a ${total} produto(s)`}</button>
        <button className="text-xs underline" onClick={() => setSel(sel.length ? [] : groups.map((g) => g.path))}>{sel.length ? "desmarcar todas" : "marcar todas"}</button>
        <Msg />
      </div>
    </div>
  );
}

export function BrandProposals({ tenantSlug, groups }: { tenantSlug: string; groups: { brand: string; count: number; samples: Sample[] }[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const { busy, run, Msg } = useRun();
  if (groups.length === 0) return <p className="text-sm text-slate-500">Nenhuma marca citada em produtos sem marca.</p>;
  return (
    <div className="space-y-2 text-sm">
      {groups.map((g) => (
        <label key={g.brand} className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={sel.includes(g.brand)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, g.brand] : s.filter((x) => x !== g.brand)))} />
          <strong>{g.brand}</strong> <span className="text-slate-500">{g.count} produto(s)</span>
          <span className="text-xs text-slate-500">ex.: {g.samples.slice(0, 2).map((s) => s.name).join(" · ")}</span>
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy || sel.length === 0} onClick={() => run(() => applyBrandsAction(tenantSlug, sel), (d) => `${d.updated} produto(s) com marca definida.`)}>Aplicar marcas selecionadas</button>
        <Msg />
      </div>
    </div>
  );
}

export function FillModels({ tenantSlug }: { tenantSlug: string }) {
  const { busy, run, Msg } = useRun();
  return (
    <div className="flex items-center gap-3">
      <button className="btn-secondary" disabled={busy} onClick={() => run(() => fillModelsAction(tenantSlug), (d) => `${d.filled} sugestão(ões) geradas em ${d.scanned} produto(s) sem modelo.`)}>{busy ? "Gerando…" : "Gerar sugestões de modelo"}</button>
      <Msg />
    </div>
  );
}

type Cat = { id: string; name: string; parentId: string | null; active: boolean; path: string; products: number; total: number; children: number };
type Brand = { id: string; name: string; active: boolean; products: number };
type Tag = { id: string; name: string; products: number };

export function TaxonomyEditor({ tenantSlug, brands, categories, tags }: { tenantSlug: string; brands: Brand[]; categories: Cat[]; tags: Tag[] }) {
  const [tab, setTab] = useState<"cat" | "brand" | "tag">("cat");
  const [editing, setEditing] = useState<string | null>(null);
  const { busy, run, Msg } = useRun();
  const depth = (c: Cat) => c.path.split(" > ").length - 1;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-1">
        {([["cat", `Categorias (${categories.length})`], ["brand", `Marcas (${brands.length})`], ["tag", `Tags (${tags.length})`]] as const).map(([k, l]) => (
          <button key={k} className={`rounded px-3 py-1 ${tab === k ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <Msg />
      {tab === "cat" && (
        <>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(() => saveCategoryAction(tenantSlug, { name: String(fd.get("name")), parentId: String(fd.get("parentId") || "") || null }), () => "Categoria criada.");
            e.currentTarget.reset();
          }}>
            <label className="flex flex-col"><span className="label">Nova categoria</span><input name="name" className="input w-56" required maxLength={120} /></label>
            <label className="flex flex-col"><span className="label">Dentro de</span>
              <select name="parentId" className="input w-72"><option value="">(raiz)</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}</select>
            </label>
            <button className="btn-secondary" disabled={busy}>Criar</button>
          </form>
          <ul className="divide-y">
            {categories.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-1" style={{ paddingLeft: depth(c) * 20 }}>
                {editing === c.id ? (
                  <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    void run(() => saveCategoryAction(tenantSlug, { id: c.id, name: String(fd.get("name")), parentId: String(fd.get("parentId") || "") || null }), () => "Categoria atualizada.").then(() => setEditing(null));
                  }}>
                    <input name="name" defaultValue={c.name} className="input w-48 py-1" maxLength={120} />
                    <select name="parentId" defaultValue={c.parentId ?? ""} className="input w-64 py-1"><option value="">(raiz)</option>{categories.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select>
                    <button className="btn-primary px-2 py-1 text-xs" disabled={busy}>Salvar</button>
                    <button type="button" className="text-xs underline" onClick={() => setEditing(null)}>cancelar</button>
                  </form>
                ) : (
                  <>
                    <a className={`font-medium hover:underline ${c.active ? "" : "text-slate-400 line-through"}`} href={`/${tenantSlug}/produtos?categoria=${c.id}`}>{c.name}</a>
                    <span className="text-xs text-slate-500">{c.total} produto(s){c.children ? ` · ${c.products} diretos` : ""}</span>
                    <span className="ml-auto flex gap-2 text-xs">
                      <button className="underline" onClick={() => setEditing(c.id)}>editar/mover</button>
                      <button className="underline" disabled={busy} onClick={() => run(() => setActiveAction(tenantSlug, "category", c.id, !c.active), () => (c.active ? "Desativada." : "Reativada."))}>{c.active ? "desativar" : "reativar"}</button>
                      {c.products === 0 && c.children === 0 && <button className="text-red-700 underline" disabled={busy} onClick={() => run(() => deleteTaxonomyAction(tenantSlug, "category", c.id), () => "Excluída.")}>excluir</button>}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "brand" && (
        <>
          <form className="flex items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void run(() => saveBrandAction(tenantSlug, { name: String(fd.get("name")) }), () => "Marca criada.");
            e.currentTarget.reset();
          }}>
            <label className="flex flex-col"><span className="label">Nova marca</span><input name="name" className="input w-56" required maxLength={120} /></label>
            <button className="btn-secondary" disabled={busy}>Criar</button>
          </form>
          <ul className="divide-y">
            {brands.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 py-1">
                {editing === b.id ? (
                  <form className="flex gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    void run(() => saveBrandAction(tenantSlug, { id: b.id, name: String(fd.get("name")) }), () => "Marca renomeada.").then(() => setEditing(null));
                  }}>
                    <input name="name" defaultValue={b.name} className="input w-48 py-1" maxLength={120} />
                    <button className="btn-primary px-2 py-1 text-xs" disabled={busy}>Salvar</button>
                  </form>
                ) : (
                  <>
                    <a className={`font-medium hover:underline ${b.active ? "" : "text-slate-400 line-through"}`} href={`/${tenantSlug}/produtos?marca=${b.id}`}>{b.name}</a>
                    <span className="text-xs text-slate-500">{b.products} produto(s)</span>
                    <span className="ml-auto flex gap-2 text-xs">
                      <button className="underline" onClick={() => setEditing(b.id)}>renomear</button>
                      <button className="underline" disabled={busy} onClick={() => run(() => setActiveAction(tenantSlug, "brand", b.id, !b.active), () => (b.active ? "Desativada." : "Reativada."))}>{b.active ? "desativar" : "reativar"}</button>
                      {b.products === 0 && <button className="text-red-700 underline" disabled={busy} onClick={() => run(() => deleteTaxonomyAction(tenantSlug, "brand", b.id), () => "Excluída.")}>excluir</button>}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "tag" && (
        <ul className="divide-y">
          {tags.length === 0 && <li className="py-1 text-slate-500">Nenhuma tag.</li>}
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1">
              <a className="hover:underline" href={`/${tenantSlug}/produtos?tag=${t.id}`}>{t.name}</a>
              <span className="text-xs text-slate-500">{t.products}</span>
              {t.products === 0 && <button className="ml-auto text-xs text-red-700 underline" disabled={busy} onClick={() => run(() => deleteTaxonomyAction(tenantSlug, "tag", t.id), () => "Excluída.")}>excluir</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
