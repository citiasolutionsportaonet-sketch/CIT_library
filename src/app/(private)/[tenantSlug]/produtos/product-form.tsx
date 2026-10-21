"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { productInputSchema, zodFieldErrors } from "@/modules/products/schema";
import { createProductAction, updateProductAction } from "./actions";

type Spec = { key: string; value: string; unit?: string };
type LinkItem = { label?: string; url: string };

export type ProductFormValues = {
  name: string;
  sku: string;
  brand: string;
  category: string;
  model: string;
  manufacturerCode: string;
  gtin: string;
  unit: string;
  description: string;
  internalNotes: string;
  tags: string;
  specs: Spec[];
  links: LinkItem[];
  status: "DRAFT" | "ACTIVE";
};

export const emptyProduct: ProductFormValues = {
  name: "",
  sku: "",
  brand: "",
  category: "",
  model: "",
  manufacturerCode: "",
  gtin: "",
  unit: "UN",
  description: "",
  internalNotes: "",
  tags: "",
  specs: [],
  links: [],
  status: "DRAFT",
};

type Props = {
  tenantSlug: string;
  initial: ProductFormValues;
  productId?: string;
  version?: number;
  suggestions: { brands: string[]; categories: string[] };
};

export function ProductForm({ tenantSlug, initial, productId, version, suggestions }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "ok" | "conflict"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(version ?? 1);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(values) !== saved;

  // Aviso de alterações não salvas ao sair da página.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = <K extends keyof ProductFormValues>(k: K, v: ProductFormValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  function payload(status: "DRAFT" | "ACTIVE") {
    return {
      ...values,
      status,
      tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
      specs: values.specs.filter((s) => s.key.trim() || s.value.trim()),
      links: values.links.filter((l) => l.url.trim()),
    };
  }

  async function submit(status: "DRAFT" | "ACTIVE") {
    if (pending) return; // proteção contra duplo clique
    setMessage(null);
    const data = payload(status);
    const local = productInputSchema.safeParse(data);
    if (!local.success) {
      setFields(zodFieldErrors(local.error));
      setMessage({ kind: "error", text: "Revise os campos destacados." });
      return;
    }
    setFields({});
    setPending(true);
    const res = productId
      ? await updateProductAction(tenantSlug, productId, currentVersion, data)
      : await createProductAction(tenantSlug, data);
    setPending(false);
    if (!res.ok) {
      setFields(res.fields);
      setMessage({
        kind: res.code === "VERSION_CONFLICT" ? "conflict" : "error",
        text: `${res.message}${res.code === "INTERNAL" ? ` (código ${res.requestId})` : ""}`,
      });
      return;
    }
    const next = { ...values, status };
    setSaved(JSON.stringify(next));
    setValues(next);
    if (productId) {
      setCurrentVersion((res.data as { version: number }).version);
      setMessage({ kind: "ok", text: "Alterações salvas." });
      router.refresh();
    } else {
      router.push(`/${tenantSlug}/produtos/${(res.data as { id: string }).id}/editar?novo=1`);
    }
  }

  const err = (k: string) => fields[k] && <p className="field-error">{fields[k]}</p>;
  const text = (k: keyof ProductFormValues, label: string, opts: { max?: number; list?: string; required?: boolean; mono?: boolean; placeholder?: string } = {}) => (
    <div>
      <label htmlFor={`f-${k}`} className="label">
        {label} {opts.required && <span className="text-red-600">*</span>}
      </label>
      <input
        id={`f-${k}`}
        className={`input ${opts.mono ? "font-mono" : ""}`}
        value={values[k] as string}
        maxLength={opts.max}
        list={opts.list}
        placeholder={opts.placeholder}
        aria-invalid={!!fields[k]}
        onChange={(e) => set(k, e.target.value as never)}
      />
      {err(k)}
    </div>
  );

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(values.status);
      }}
    >
      {message && (
        <div
          role="alert"
          className={`rounded-md p-3 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
          {message.kind === "conflict" && (
            <button type="button" className="ml-2 underline" onClick={() => window.location.reload()}>
              Recarregar agora
            </button>
          )}
        </div>
      )}

      <section className="card grid gap-4 p-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-semibold">Identificação</h2>
        {text("name", "Nome", { max: 200, required: true })}
        {text("sku", "SKU interno", { max: 80, required: true, mono: true })}
        {text("brand", "Marca", { max: 120, list: "brand-options", placeholder: "Ex.: Intelbras" })}
        {text("model", "Modelo", { max: 120 })}
        {text("manufacturerCode", "Código do fabricante", { max: 120, mono: true })}
        {text("gtin", "EAN/GTIN", { max: 14, mono: true })}
        {text("category", "Categoria", { max: 120, list: "category-options" })}
        {text("unit", "Unidade", { max: 20 })}
        <div className="md:col-span-2">
          <label htmlFor="f-tags" className="label">Tags (separadas por vírgula)</label>
          <input id="f-tags" className="input" value={values.tags} onChange={(e) => set("tags", e.target.value)} aria-invalid={!!fields.tags} />
          {err("tags")}
        </div>
        <datalist id="brand-options">{suggestions.brands.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="category-options">{suggestions.categories.map((c) => <option key={c} value={c} />)}</datalist>
        <p className="md:col-span-2 text-xs text-slate-500">
          Para salvar rascunho bastam nome e SKU. Para ativar: marca e modelo. Código do fabricante exige marca.
        </p>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Descrição</h2>
        <textarea className="input min-h-32" maxLength={20000} value={values.description} onChange={(e) => set("description", e.target.value)} aria-label="Descrição" aria-invalid={!!fields.description} />
        {err("description")}
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex items-center">
          <h2 className="font-semibold">Características técnicas</h2>
          <button type="button" className="btn-secondary ml-auto" disabled={values.specs.length >= 100} onClick={() => set("specs", [...values.specs, { key: "", value: "", unit: "" }])}>
            Adicionar
          </button>
        </div>
        {values.specs.length === 0 && <p className="text-sm text-slate-500">Nenhuma característica.</p>}
        {values.specs.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_8rem_auto] gap-2">
            <input className="input" placeholder="Característica" aria-label={`Característica ${i + 1}`} value={s.key} maxLength={120} aria-invalid={!!fields[`specs.${i}.key`]}
              onChange={(e) => set("specs", values.specs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            <input className="input" placeholder="Valor" aria-label={`Valor ${i + 1}`} value={s.value} maxLength={500} aria-invalid={!!fields[`specs.${i}.value`]}
              onChange={(e) => set("specs", values.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <input className="input" placeholder="Unidade" aria-label={`Unidade ${i + 1}`} value={s.unit ?? ""} maxLength={30}
              onChange={(e) => set("specs", values.specs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
            <button type="button" className="btn-secondary" aria-label={`Remover característica ${i + 1}`} onClick={() => set("specs", values.specs.filter((_, j) => j !== i))}>✕</button>
            {(fields[`specs.${i}.key`] || fields[`specs.${i}.value`]) && <p className="field-error col-span-4">{fields[`specs.${i}.key`] ?? fields[`specs.${i}.value`]}</p>}
          </div>
        ))}
        {err("specs")}
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex items-center">
          <h2 className="font-semibold">Links oficiais</h2>
          <button type="button" className="btn-secondary ml-auto" disabled={values.links.length >= 20} onClick={() => set("links", [...values.links, { label: "", url: "" }])}>
            Adicionar
          </button>
        </div>
        {values.links.length === 0 && <p className="text-sm text-slate-500">Nenhum link.</p>}
        {values.links.map((l, i) => (
          <div key={i} className="grid grid-cols-[12rem_1fr_auto] gap-2">
            <input className="input" placeholder="Rótulo" aria-label={`Rótulo do link ${i + 1}`} value={l.label ?? ""} maxLength={120}
              onChange={(e) => set("links", values.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input" placeholder="https://" aria-label={`URL do link ${i + 1}`} value={l.url} maxLength={2000} aria-invalid={!!fields[`links.${i}.url`]}
              onChange={(e) => set("links", values.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <button type="button" className="btn-secondary" aria-label={`Remover link ${i + 1}`} onClick={() => set("links", values.links.filter((_, j) => j !== i))}>✕</button>
            {fields[`links.${i}.url`] && <p className="field-error col-span-3">{fields[`links.${i}.url`]}</p>}
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Observações internas</h2>
        <p className="text-xs text-slate-500">Visíveis apenas para quem pode editar produtos.</p>
        <textarea className="input min-h-20" maxLength={10000} value={values.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} aria-label="Observações internas" />
        {err("internalNotes")}
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3">
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => void submit("DRAFT")}>
          {pending ? "Salvando…" : "Salvar rascunho"}
        </button>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => void submit("ACTIVE")}>
          {pending ? "Salvando…" : values.status === "ACTIVE" && productId ? "Salvar (ativo)" : "Salvar e ativar"}
        </button>
        {dirty && <span className="text-sm text-amber-700">Alterações não salvas</span>}
        <Link href={productId ? `/${tenantSlug}/produtos/${productId}` : `/${tenantSlug}/produtos`} className="ml-auto text-sm text-slate-600 hover:underline">
          {productId ? "Ver produto" : "Cancelar"}
        </Link>
      </div>
    </form>
  );
}
