"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { reorderMediaAction, setCoverAction, unlinkMediaAction, updateAltTextAction } from "./actions";

export type PhotoItem = { id: string; altText: string; originalName: string; width: number | null; height: number | null };

type Upload = { key: string; name: string; progress: number; status: "enviando" | "processando" | "erro" | "ok"; error?: string };

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function precheck(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
    return "HEIC não é aceito ainda. Exporte como JPEG ou PNG (app Fotos ou Pré-Visualização → Exportar).";
  }
  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) return "Formato não aceito. Use JPEG, PNG ou WebP.";
  if (file.size > MAX_BYTES) return "Arquivo acima de 10 MB.";
  if (file.size === 0) return "Arquivo vazio.";
  return null;
}

export function PhotoManager({
  tenantSlug,
  productId,
  photos,
  coverMediaId,
  maxPhotos,
}: {
  tenantSlug: string;
  productId: string;
  photos: PhotoItem[];
  coverMediaId: string | null;
  maxPhotos: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState(photos);
  const [cover, setCover] = useState(coverMediaId);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincroniza com dados novos do servidor (após router.refresh) sem efeito.
  const [prev, setPrev] = useState({ photos, coverMediaId });
  if (prev.photos !== photos || prev.coverMediaId !== coverMediaId) {
    setPrev({ photos, coverMediaId });
    setItems(photos);
    setCover(coverMediaId);
  }

  const patchUpload = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  function sendOne(file: File, key: string): Promise<void> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/t/${encodeURIComponent(tenantSlug)}/products/${productId}/media`);
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patchUpload(key, { progress: Math.round((e.loaded / e.total) * 100), status: e.loaded >= e.total ? "processando" : "enviando" });
      };
      xhr.onload = () => {
        if (xhr.status === 201) patchUpload(key, { status: "ok", progress: 100 });
        else {
          let msg = "Falha no envio.";
          try {
            msg = JSON.parse(xhr.responseText).error.message ?? msg;
          } catch {
            /* resposta não JSON */
          }
          patchUpload(key, { status: "erro", error: msg });
        }
        resolve();
      };
      xhr.onerror = () => {
        patchUpload(key, { status: "erro", error: "Conexão interrompida. Tente novamente." });
        resolve();
      };
      xhr.send(file);
    });
  }

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const room = maxPhotos - items.length;
    const queue: { file: File; key: string }[] = [];
    const next: Upload[] = [];
    files.forEach((file, i) => {
      const key = `${Date.now()}-${i}-${file.name}`;
      const pre = precheck(file);
      if (pre) next.push({ key, name: file.name, progress: 0, status: "erro", error: pre });
      else if (queue.length >= room) next.push({ key, name: file.name, progress: 0, status: "erro", error: `Limite de ${maxPhotos} fotos por produto.` });
      else {
        queue.push({ file, key });
        next.push({ key, name: file.name, progress: 0, status: "enviando" });
      }
    });
    setUploads((u) => [...u.filter((x) => x.status !== "ok"), ...next]);
    // Envio sequencial: previsível para o servidor e para o progresso.
    for (const q of queue) await sendOne(q.file, q.key);
    if (queue.length) router.refresh();
  }

  async function act(fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.message ?? "Falha na operação.");
    router.refresh();
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const order = [...items];
    [order[i], order[j]] = [order[j], order[i]];
    setItems(order);
    void act(() => reorderMediaAction(tenantSlug, productId, order.map((p) => p.id)));
  }

  return (
    <section className="card space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Fotos</h2>
        <span className="text-sm text-slate-500">{items.length}/{maxPhotos}</span>
      </div>

      <div
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-sm ${drag ? "border-slate-600 bg-slate-50" : "border-slate-300"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        <p className="mb-2 text-slate-600">Arraste fotos aqui ou</p>
        <button type="button" className="btn-secondary" disabled={items.length >= maxPhotos} onClick={() => inputRef.current?.click()}>
          Selecionar fotos
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          data-testid="photo-input"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-2 text-xs text-slate-500">JPEG, PNG ou WebP · até 10 MB · máx. 40 megapixels · HEIC não suportado</p>
      </div>

      {uploads.length > 0 && (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-2">
              <span className="truncate">{u.name}</span>
              {u.status === "erro" ? (
                <span className="text-red-700">— {u.error}</span>
              ) : u.status === "ok" ? (
                <span className="text-green-700">— enviada</span>
              ) : (
                <>
                  <progress max={100} value={u.progress} className="h-2 w-32" />
                  <span className="text-slate-500">{u.status === "processando" ? "processando…" : `${u.progress}%`}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-amber-700">Sem fotos. Recomendado adicionar pelo menos uma.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <li key={p.id} className={`rounded-lg border p-2 ${cover === p.id ? "border-slate-900 ring-2 ring-slate-900" : "border-slate-200"}`}>
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${p.id}?v=thumb`} alt={p.altText || p.originalName} className="h-full w-full object-contain" />
                {cover === p.id && <span className="absolute left-1 top-1 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-white">Capa</span>}
              </div>
              <input
                className="input mt-2 text-xs"
                placeholder="Texto alternativo"
                aria-label={`Texto alternativo da foto ${i + 1}`}
                maxLength={250}
                defaultValue={p.altText}
                onBlur={(e) => {
                  if (e.target.value !== p.altText) void act(() => updateAltTextAction(tenantSlug, productId, p.id, e.target.value));
                }}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Mover foto ${i + 1} para a esquerda`}>◀</button>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Mover foto ${i + 1} para a direita`}>▶</button>
                {cover !== p.id && (
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => { setCover(p.id); void act(() => setCoverAction(tenantSlug, productId, p.id)); }}>
                    Definir capa
                  </button>
                )}
                <button
                  type="button"
                  className="btn-danger px-2 py-1 text-xs"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Remover esta foto do produto?")) void act(() => unlinkMediaAction(tenantSlug, productId, p.id));
                  }}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
