import { formatBRL } from "@/modules/pricing/calc";

type Pricing = {
  cost: string | null;
  markupPct: string | null;
  citPrice: string | null;
  marketMedian: string | null;
  marketCount: number;
  marketSufficient: boolean;
  webReference: string | null;
  diffAbs: string | null;
  diffPct: string | null;
};

/** Duas metodologias lado a lado, nunca misturadas. Custo só para quem pode ver. */
export function PricingSection({ pricing: p, canSeeCost }: { pricing: Pricing; canSeeCost: boolean }) {
  const diff = p.diffAbs ? Number(p.diffAbs) : null;
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Preços</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">1. Preço CIT{canSeeCost ? " (custo + markup)" : ""}</h3>
          <dl className="mt-2 space-y-1 text-sm">
            {canSeeCost && (
              <div className="flex justify-between"><dt className="text-slate-500">Custo no distribuidor <span className="text-[11px]">(interno)</span></dt><dd>{p.cost ? formatBRL(p.cost) : "sem custo informado"}</dd></div>
            )}
            {canSeeCost && p.markupPct !== null && (
              <div className="flex justify-between"><dt className="text-slate-500">Markup sobre custo</dt><dd>{p.markupPct.replace(".", ",")}%</dd></div>
            )}
            <div className="flex justify-between text-base font-semibold"><dt>Preço CIT</dt><dd>{formatBRL(p.citPrice)}</dd></div>
          </dl>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <h3 className="text-sm font-semibold">2. Mercado online (cotações aceitas)</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Mediana online</dt><dd>{formatBRL(p.marketMedian)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Ofertas consideradas</dt><dd>{p.marketCount}{p.marketCount > 0 && !p.marketSufficient ? " (abaixo do mínimo)" : ""}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Referência comercial (mediana + 15%)</dt><dd>{formatBRL(p.webReference)}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-500">A referência comercial é um cálculo interno sobre a mediana; não é um preço anunciado na internet.</p>
        </div>
      </div>
      <p className="mt-3 text-sm">
        Diferença Preço CIT × mediana online:{" "}
        {diff === null ? <span className="text-slate-500">sem dados suficientes</span> : (
          <strong className={diff > 0 ? "text-red-700" : "text-green-700"}>
            {formatBRL(p.diffAbs)} ({p.diffPct?.replace(".", ",")}%) {diff > 0 ? "acima do mercado" : "abaixo do mercado"}
          </strong>
        )}
      </p>
    </section>
  );
}
