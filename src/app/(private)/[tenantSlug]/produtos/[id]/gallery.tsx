"use client";

import { useState } from "react";

export function Gallery({ photos, coverId }: { photos: { id: string; alt: string }[]; coverId: string | null }) {
  const ordered = coverId ? [...photos.filter((p) => p.id === coverId), ...photos.filter((p) => p.id !== coverId)] : photos;
  const [current, setCurrent] = useState(0);
  if (ordered.length === 0) {
    return <div className="card flex aspect-square items-center justify-center text-sm text-slate-400">Sem fotos</div>;
  }
  const active = ordered[Math.min(current, ordered.length - 1)];
  return (
    <div className="space-y-3">
      <div className="card flex aspect-square items-center justify-center overflow-hidden bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/media/${active.id}`} alt={active.alt} className="max-h-full max-w-full object-contain" />
      </div>
      {ordered.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {ordered.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => setCurrent(i)} className={`h-16 w-16 overflow-hidden rounded border ${p.id === active.id ? "border-slate-900 ring-2 ring-slate-900" : "border-slate-200"}`} aria-label={`Ver foto ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${p.id}?v=thumb`} alt="" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
